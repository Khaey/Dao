# P2.2-E — Signature électronique des contrats D.A.O. (Tunisie)

Owner de la première tranche frontend/lecture : **DAO COPILOT 4**, [#383](https://github.com/Khaey/Dao/issues/383). Coordination [#204](https://github.com/Khaey/Dao/issues/204). Cette fiche n'active **aucun effet juridique**.

## État exact au 21 octobre 2026

- **P2.2-A/B/C/D existants** : contrat par `award`, versions canoniques immuables avec hash SHA-256, parties Client / Artisan / D.A.O., acceptations techniques contrôlées sur version, validation D.A.O. **uniquement vers `ready`**, avenants non engageants et consultation privée.
- La commande service-only `start_contract_acceptance` bloque `p_legal_effect_enabled=true`. `record_contract_acceptance` ne peut pas être appelée depuis le navigateur comme une signature. Ces protections doivent rester.
- **P2.2-E1 livrable** : checklist de préparation en lecture seule dans `/app/contracts/[id]`. Elle s'appuie sur le DTO contractuel privé, affiche la présence de la version/hash, des trois parties, des **accords de la version courante seulement**, du contrôle D.A.O. et l'absence de fournisseur/validation juridique. Aucun bouton de signature, aucune écriture, aucun appel tiers, aucun OTP.
- Le PDF de l'offre/devis, le contenu du contrat, une preuve d'acceptation technique et un PDF contractuel **réellement signé** sont des artefacts distincts. Il est interdit de déclarer l'un équivalent à l'autre.
- **#381 / CH2** développe une surcouche chantier×Artisan multi-awards. Ce lot ne change ni l'unicité `contracts.award_id` ni son modèle RLS ; il doit fonctionner sur les contrats techniques existants jusqu'à la réconciliation #381.

## Parcours cible après validation des prérequis

1. Attribution du/des lots, création d'un dossier contractuel non signé seulement quand la configuration le permet ; regroupement chantier×Artisan géré séparément par #381, sans modifier des versions acceptées.
2. Préparation du PDF contractuel **canonique**, annexes, liste des lots et montant de référence en millimes, noms juridiques et mandats des représentants, version contractuelle et SHA-256. Verrouillage atomique de tout le paquet documentaire avant envoi.
3. **Artisan** : identification robuste du représentant autorisé et signature au moyen du prestataire agréé, sur le digest du document exact. **Client** : même exigence sur le **même paquet figé**. Ordre des deux signatures à valider, sans forcer l'inscription à D.A.O. d'un simple membre de chantier.
4. Vérification côté serveur pour chaque signataire : intégrité documentaire, certificat et chaîne de confiance, validité/révocation, rôle, identité/mandat, horodatage et preuve du prestataire. Ne jamais prendre une réponse browser ou callback non authentifié comme preuve. Stocker référence et empreinte de preuve, pas de PIN/OTP.
5. **D.A.O.** : validation par un représentant juridiquement habilité de LogicLab Tunisie, distincte des deux signatures. Aucun statut `signed` ni `legal_effect_enabled=true` avant validation des conditions légales et preuve de bout en bout.
6. Archivage privé immuable du PDF signé et de son journal d'audit avec accès par JWT/RLS pour les parties exactes. Aucune activation de paiement, dette, réception ou début automatique des travaux.

## Préconditions bloquantes pour P2.2-E2 — non acquises

- **Juriste tunisien** : confirmer les clauses tripartites (rôle/responsabilités de LogicLab Tunisie), la compétence légale de chaque représentant, le niveau de signature requis et la valeur des preuves pour chaque catégorie de Client/Artisan.
- **Prestataire qualifié / intégration** : sélectionner **un fournisseur** et contractualiser l'accès API et un bac à sable, les vérifications d'identité, certificats, signatures PDF (ex. PAdES), journal d'audit, notifications et SLA. TunTrust/DigiGO et NGSign sont des pistes, **pas un choix acquis**.
- **Sécurité** : vérification serveur des notifications signées, anti-rejeu/idempotence, version/hash exacts, désactivation et révocation, reprise des erreurs, cohérence multi-lots, stockage privé, données sensibles et conservation, suivi des tentatives.
- **OPS** : déploiement DEV et éventuelles migrations additives sous autorisation séparée ; pas d'utilisation des certificats ou secrets de production en DEV.
- **Recette réelle** : deux identités de test distinctes, D.A.O. habilité, parcours complet signé vérifiable et tentative adversariale (mauvais contrat, mauvaise version, artisan concurrent, document altéré, callback forgé, double callback, certificat expiré).

## Références externes (validation finale requise)

- [Loi tunisienne n° 2000-83 du 9 août 2000 — cadre légal TunTrust](https://www.tuntrust.tn/ar/content/%D8%A7%D9%84%D8%A5%D8%B7%D8%A7%D8%B1-%D8%A7%D9%84%D9%82%D8%A7%D9%86%D9%88%D9%86%D9%8A-0).
- [TunTrust DigiGO — signature à distance et intégration](https://www.tuntrust.tn/fr/content/digigo).
- [TunTrust — acquisition de certificats DigiGO qualifiés](https://certification.tn/fr/nos-produits/Certificat%20de%20signature%20Digigo).
- [API NGSign, version simplifiée publiquement documentée](https://www.ng-sign.com/api-reference-simple-version/) : `POST /server/protected/transaction/pdfs/` charge les PDF en Base64, `POST /server/protected/transaction/{uuid}/launch` configure deux signataires, `GET /server/any/transaction/{uuid}/` permet de lire le statut, puis `GET /server/any/transaction/{uuid}/pdfs/{documentUuid}` fournit le PDF. Le type `DIGI_GO`, l'invitation `BY_MAIL` et l'option `OTP` sont décrits, mais leur combinaison doit être validée en sandbox. **Aucun appel à ces routes n'est effectué par D.A.O. à ce stade.**
- [API officielle DIGIGO, documentation publique version 01.5 datée du 17 mars 2025](https://digigo.tuntrust.tn/pub/documentation) : sections `oauth2/authorize`, `oauth2/token`, `signatures/signHash`, `Timestamp` et validation de signature. Évaluer l'intégration directe, sans supposer la disponibilité d'un compte partenaire.
- [TunTrust : adhésion comme entité d'intégration](https://www.ance.tn/fr/solutions/digigo) : l'accès aux services à travers le partenariat impose une convention signée. NGSign affiche une **offre de sandbox de 40 jours sur demande** ; cela ne signifie pas que D.A.O. dispose d'un compte, de quotas ou de clés.
- Les conditions commerciales réelles, l'API avancée de NGSign, les contrats d'intégration, les clés de sandbox, le format final du PDF et la validation juridique demeurent **à obtenir**.

## P2.2-E2a — préflight fournisseur (implémentation hors ligne)

Le module `dao-backend/src/services/ContractSignaturePreflight.ts` génère uniquement un **plan de préparation** pour le candidat NGSign/DigiGO : comparaison `contractVersionId === currentVersionId`, SHA-256 du contenu PDF à transmettre, présence des noms et des rôles, Client et Artisan distincts, dossier toujours non engageant, statut admissible, format et taille PDF élémentaires. Il décrit les choix candidat NGSign `DIGI_GO`, `BY_MAIL`, `OTP` pour les deux signataires. Tests dédiés dans `dao-backend/tests/contract-signature-preflight.test.ts`.

**Limites impératives** : ce module n'est **pas un validateur PDF**, ni un contrôleur de certificats, ni un système de signature. Il ne contient ni URL d'API, ni jeton, ni requête réseau, ni upload, ni appel `launch`, ni webhook, ni transition métier. Les noms et emails ne sont pas restitués dans le plan et ne doivent pas être enregistrés dans des logs. Le partenaire ne peut pas être activé par la simple présence d'un PDF et d'un hash : le juriste tunisien, l'accès commercial, les certificats, les permissions serveur et la validation cryptographique des signatures restent des gates externes.


**Décision d'activation future à matérialiser :** fournisseur sélectionné, validation juridique du contrat, représentant D.A.O. attesté et feu vert OPS. Jusqu'à cela, l'écran reste une **préparation** et le dossier « Non signé — aucun effet juridique ».
