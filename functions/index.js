/**
 * Cloud Functions – Integração Alexa ↔ Firebase (Firestore)
 * Projeto: Peguei o último
 *
 * Rotas:
 *  - POST /claimAlexa       { alexaUserId, convite }
 *  - POST /addItemViaAlexa  { alexaUserId, item }
 *
 * Segurança:
 *  - Header obrigatório: x-api-key (mesmo valor setado em `ALEXA_API_KEY`)
 *    Use: firebase functions:secrets:set ALEXA_API_KEY
 */

const { setGlobalOptions, logger } = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

admin.apps.length ? admin.app() : admin.initializeApp();
const db = admin.firestore();

// Região padrão para todas as funções
setGlobalOptions({ region: 'us-central1' });

/* ───────────── Helpers ───────────── */
function cors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function checkApiKey(req) {
  const sent = (req.get('x-api-key') || '').trim();
  const expected = (process.env.ALEXA_API_KEY || '').trim();
  return sent && expected && sent === expected;
}

// normaliza convites/UIDs para comparação tolerante
function normalizeConvite(v) {
  if (!v) return '';
  return String(v).replace(/[\s-]+/g, '').trim().toUpperCase();
}

function normalizeItem(text) {
  if (!text) return '';
  return String(text).trim();
}

async function getAlexaLink(alexaUserId) {
  const snap = await db.collection('AlexaLinks').doc(alexaUserId).get();
  return snap.exists ? (snap.data() || null) : null;
}

async function findActiveListByOwner(ownerRaw) {
  if (!ownerRaw) return null;

  const convite = String(ownerRaw);
  const conviteNorm = normalizeConvite(ownerRaw);

  // 1) Usuario == convite (exato)
  let snap = await db
    .collection('Lista')
    .where('Usuario', '==', convite)
    .where('Ativa', '==', true)
    .limit(1)
    .get();
  if (!snap.empty) return snap.docs[0].ref;

  // 2) Usuario == conviteNorm (tolerante a caixa/ruído)
  snap = await db
    .collection('Lista')
    .where('Usuario', '==', conviteNorm)
    .where('Ativa', '==', true)
    .limit(1)
    .get();
  if (!snap.empty) return snap.docs[0].ref;

  // 3) UsuarioNorm == conviteNorm (se você vier a gravar esse campo no app)
  snap = await db
    .collection('Lista')
    .where('UsuarioNorm', '==', conviteNorm)
    .where('Ativa', '==', true)
    .limit(1)
    .get();
  if (!snap.empty) return snap.docs[0].ref;

  return null;
}

/* ───────────── Rotas ───────────── */

/**
 * POST /claimAlexa
 * Body: { alexaUserId, convite }
 * Vincula alexaUserId → convite em AlexaLinks/{alexaUserId}
 */
exports.claimAlexa = onRequest(
  { secrets: ['ALEXA_API_KEY'] },
  async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST' });
    if (!checkApiKey(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    try {
      const { alexaUserId, convite } = req.body || {};
      if (!alexaUserId || !convite) {
        return res.status(400).json({ ok: false, error: 'alexaUserId e convite são obrigatórios' });
      }

      const conviteNorm = normalizeConvite(convite);

      logger.info('[claimAlexa] linkando', { alexaUserId, convite, conviteNorm });

      await db.collection('AlexaLinks').doc(alexaUserId).set(
        {
          convite,
          conviteNorm,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return res.json({ ok: true, conviteNorm });
    } catch (err) {
      logger.error('claimAlexa error', err);
      return res.status(500).json({ ok: false, error: 'internal' });
    }
  }
);

/**
 * POST /addItemViaAlexa
 * Body: { alexaUserId, item }
 * Passos:
 * 1) Lê AlexaLinks/{alexaUserId} → { convite, conviteNorm }
 * 2) Busca Lista ativa do dono tentando:
 *    - Usuario == convite
 *    - Usuario == conviteNorm
 *    - UsuarioNorm == conviteNorm
 * 3) Cria em Lista/{listaId}/Itens um doc { Descricao, Achei:false, createdAt }
 */
exports.addItemViaAlexa = onRequest(
  { secrets: ['ALEXA_API_KEY'] },
  async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST' });
    if (!checkApiKey(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    try {
      let { alexaUserId, item } = req.body || {};
      if (!alexaUserId || !item) {
        return res.status(400).json({ ok: false, error: 'alexaUserId e item são obrigatórios' });
      }

      item = normalizeItem(item);
      if (!item) return res.status(400).json({ ok: false, error: 'item vazio' });

      const link = await getAlexaLink(alexaUserId);
      if (!link) {
        logger.warn('[addItemViaAlexa] link não encontrado', { alexaUserId });
        return res.status(404).json({
          ok: false,
          error: 'convite_nao_encontrado',
          message: 'Associe primeiro sua Alexa no app (enviando o convite).',
        });
      }

      const convite = link.convite || '';
      const conviteNorm = link.conviteNorm || normalizeConvite(convite);

      logger.info('[addItemViaAlexa] procurando lista', { alexaUserId, convite, conviteNorm });

      const listaRef = await findActiveListByOwner(convite || conviteNorm);
      if (!listaRef) {
        logger.warn('[addItemViaAlexa] lista ativa não encontrada', { convite, conviteNorm });
        return res.status(404).json({
          ok: false,
          error: 'lista_nao_encontrada',
          message: 'Não há lista ativa para o convite informado.',
        });
      }

      const newDoc = {
        Descricao: item,
        Achei: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'alexa',
        alexaUserId,
      };

      // subcoleção padronizada "Itens"
      const addRes = await listaRef.collection('Itens').add(newDoc);

      logger.info('[addItemViaAlexa] item criado', {
        listId: listaRef.id,
        itemId: addRes.id,
        descricao: item,
      });

      return res.json({
        ok: true,
        listId: listaRef.id,
        itemId: addRes.id,
        descricao: item,
        mensagem: `Item "${item}" adicionado com sucesso.`,
      });
    } catch (err) {
      logger.error('addItemViaAlexa error', err);
      return res.status(500).json({ ok: false, error: 'internal' });
    }
  }
);
