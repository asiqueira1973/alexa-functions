# Alexa Functions (Peguei o Último)

Cloud Functions do Firebase que ligam um skill da Alexa ao app de lista de compras Peguei o Último: vinculam a conta da Alexa a um convite e adicionam itens à lista ativa por voz.

## Principais funcionalidades

- `POST /claimAlexa` — recebe `{ alexaUserId, convite }` e grava o vínculo em `AlexaLinks/{alexaUserId}`.
- `POST /addItemViaAlexa` — recebe `{ alexaUserId, item }`, encontra a lista ativa do dono do convite e cria o item na subcoleção `Itens`.
- Normalização tolerante do convite (ignora espaços, hífens e caixa) na busca da lista.
- Rotas protegidas por chave compartilhada no header `x-api-key`, guardada como secret do Firebase (`ALEXA_API_KEY`).

## Stack técnica

- JavaScript (Node.js 22)
- Firebase Cloud Functions (2ª geração, `onRequest`)
- Firebase Admin SDK com Cloud Firestore

## Como foi construído

Desenvolvido com Claude (Anthropic). Este repositório tem só o código das funções: não há especificação SDD (spec.md), testes automatizados, hooks nem CI.

## Status

Em desenvolvimento.

## Licença

O código está disponível apenas para leitura e estudo. Veja [LICENSE](LICENSE).

## Contribuições

Issues são bem-vindas; pull requests não são aceitos. Veja [CONTRIBUTING.md](CONTRIBUTING.md).

## Como rodar

Requer o [Firebase CLI](https://firebase.google.com/docs/cli).

```bash
cd functions
npm install
firebase functions:secrets:set ALEXA_API_KEY   # chave exigida no header x-api-key
npm run serve                                  # emulador local das funções
npm run deploy                                 # publica as funções
```

Para o emulador, a chave pode ficar num `functions/.env` local (veja [`functions/.env.example`](functions/.env.example)).

---

Feito pela [Dab Lab](https://www.dablab.com.br/) — product studio de software e IA que constrói apps para pequenas empresas, startups e áreas dentro de grandes empresas, partindo de uma especificação (Spec-Driven Development) e com as disciplinas de engenharia de software robusta.
