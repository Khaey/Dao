# D.A.O. — Dropbox Sign API en mode test (issue #509)

**Objectif :** mettre au point le parcours Artisan → Client avec un environnement d'API non engageant, puis conserver NGSIGN comme adaptateur tunisien pour les validations finales. Ce connecteur est **une expérimentation technique, pas la signature juridique de D.A.O.**

## Documents de référence officiels

- [Documentation API et fonctionnement de test_mode](https://developers.hellosign.com/docs/overview)
- [POST signature_request/send : signataires ordonnés](https://developers.hellosign.com/api/signature-request/send)
- [Callbacks, signature d'événements et retries](https://developers.hellosign.com/docs/guides/events-and-callbacks/walkthrough)
- [Test mode vs production](https://developers.hellosign.com/api/manual-reference-pages/glossary)

Dropbox Sign **ne possède pas un sandbox isolé** : une même API/clé peut servir aux requêtes de test et live ; le paramètre `test_mode=1` doit donc être systématiquement imposé. Le mode test permet des signatures à filigrane, **non engageantes** et peut envoyer des e-mails aux signataires. Choisir seulement des adresses de test consentantes. Une éventuelle version live chez ce prestataire n'est **pas** dans le périmètre #509.

## Code livré dans la première tranche

- `dao-backend/src/integrations/providers/dropboxSignTestTransport.ts` : envoie un PDF à 2 signataires dans l'ordre **Artisan 0 puis Client 1** ; refuse toute tentative `live`, signature juridique active, fichier altéré, ancienne version, doubles signataires. Le paramètre `test_mode=1` est **littéral et non paramétrable**.
- `readTestStatus` récupère un état marqué `test_only`; jamais de transition `contracts.signed`.
- `dao-backend/tests/dropbox-sign-sandbox.test.ts` : faux `fetch`, pas de réseau externe, pas de clé ni mail réel dans CI.

**Limitations assumées :** le connecteur n'est pas encore branché à une route/API D.A.O., au serveur Auth, aux dossiers réels, au stockage PDF/évidence ou à un webhook vérifié. Aucun vrai test API Dropbox n'a eu lieu. Le client nécessite une injection explicite du `fetcher` et d'une clé de compte **côté serveur** avant appel.

## Suite de développement sans engagement financier ni juridique

1. Le propriétaire crée un **compte API Dropbox Sign gratuit** et met une clé dans un secret réservé à DEV (pas de secret dans le chat, PR, historique Git ou variable NEXT_PUBLIC).
2. Définir une opération test isolée avec un PDF **entièrement fictif** et deux e-mails appartenant aux testeurs autorisés ; déclencher seulement après connexion avec le secret. Pas d'effet juridique, même si une personne clique Signer dans la page fournisseur.
3. Mettre en place **un webhook vérifié selon la doc officielle**. Contrôler l'origine et les événements, l'idempotence, les doubles événements et leur ordre, puis récupérer le PDF signé marqué TEST et son audit. **Attention : signature_request_all_signed et signature_request_downloadable sont des événements distincts**.
4. Brancher les tests au même flux abstrait D.A.O. sans appeler le constructeur fournisseur directement depuis le frontend.
5. Une fois les tests stables, intégrer NGSIGN sur le même contrat de domaine ; déclencher les 40 jours gratuits au moment utile.
6. La validation d'un contrat réellement engageant (si autorisée plus tard) restera subordonnée à une revue juridique tunisienne, aux identités/mandats, au document canonique, à la signature qualifiée ou simple appropriée, au contrôle serveur des preuves et à la validation finale D.A.O.

## Décisions de continuité

- Module multi-fournisseurs #505 déjà fusionné ; #509 **est un transport HTTP TEST uniquement**, pas la configuration Admin.
- Propriétaire Settings #423 : aucun changement S1–S4.
- Signature P2.2-E #383 : `legal_effect_enabled=false`, fondations techniques déjà existantes mais pas d'appel prestataire.
- Escrow #507 : indépendant, aucune banque/prestataire de séquestre identifié juridiquement pour le cas D.A.O.

**La gratuité du mode test est indiquée par Dropbox Sign au moment de cette spécification ; aucune garantie contractuelle de gratuité sans limite dans le futur n'est présumée.**
