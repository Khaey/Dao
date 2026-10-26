# D.A.O. — Architecture des intégrations externes multi-fournisseurs (I0)

> **Statut : spécification / design, NON déployée.** Source : décision propriétaire [#505](https://github.com/Khaey/Dao/issues/505), 26/10/2026. Mise en œuvre conditionnée à des missions distinctes et aux prérequis légaux. Ce document ne crée aucun droit à signer, débiter, bloquer, conserver ou libérer des fonds.
>
> **Objectif :** permettre à D.A.O. de choisir et changer le prestataire **des nouveaux dossiers** par domaine et par marché, sans réécrire les contrats, les règles métier ni l'historique. Les dossiers déjà initiés gardent leur fournisseur et leur version d'API.

## 1. Contexte et réutilisation obligatoires

- Moteur Settings existant : [#423](https://github.com/Khaey/Dao/issues/423), `dao-backend/src/settings/catalog.ts`, `docs/product/settings-engine.md`. Il possède un **catalogue de capacités typées**, des politiques d'activation et un historique audité. Ne pas le dupliquer ni y stocker des identifiants API.
- Contrats : [#61](https://github.com/Khaey/Dao/issues/61), `docs/product/contract-v1-design.md`. **Un contrat par award** (l'agrégat chantier × Artisan est une projection), immutabilité version/hash, parties exactes, signatures Client/Artisan distinctes et contrôle D.A.O. final.
- Signature : [#383](https://github.com/Khaey/Dao/issues/383), [PR #385](https://github.com/Khaey/Dao/pull/385) (checklist) et [PR #386](https://github.com/Khaey/Dao/pull/386) (`ContractSignaturePreflight` **hors ligne**). Aucun appel prestataire ni bouton « Signer » réel actuellement ; `legal_effect_enabled=false`.
- Source de vérité Auth/RLS et financière : Supabase PostgreSQL. Montants TND en **millimes** ; ledger append-only, aucune opération bancaire implicite, aucune union de droits pour un utilisateur double rôle.
- Gouvernance : Coordinateur Claude Mission 2 reste owner de Settings S1–S4 ; le présent I0 ne modifie pas son catalogue, ses pages ou ses migrations.

## 2. Frontières d'architecture

```text
UI Client / Artisan / Admin
    │                  Admin → Paramètres → Intégrations (proposé)
    ▼                                        │ choix contrôlé, sans secrets
Services métier D.A.O.                    ConfigurationRegistry
contrats / documents /                    (catalogue de connecteurs connus,
échéances / ledger                         marché, capacités, état, politique)
    │                                        │
    └────────► ProviderResolver ◄────────────┘
                         │ contrôle serveur du feature gate, rôle, marché,
                         │ statut de disponibilité et préconditions
               ┌─────────┼──────────────┐
               ▼         ▼              ▼
        SignatureProvider EscrowProvider PaymentProvider
          NGSign/...       banque/...     PSP/...
               │              │              │
               └──────────────┴──────────────┘
                   APIs partenaires (serveur uniquement)
```

**Pas d'adaptateur HTTP générique basé sur une URL arbitraire.** Chaque prestataire est un module codé, revu, testé, doté d'un identifiant stable et d'une liste **déclarée** de capacités. Les secrets restent dans un gestionnaire de secrets ou dans l'environnement protégé, référencés par identifiant opaque et **jamais** renvoyés par DTO.

**Séparer trois statuts :**
1. `implemented` : adaptateur intégré au code et testé (information d'inventaire).
2. `connection_status` : non configuré, vérification sandbox valide, indisponible, ou erreur (observation technique).
3. `activation` : `disabled` | `sandbox` | `live`, décision Admin auditée **qui ne peut jamais contourner les préconditions juridiques, contractuelles, de pays et de capacité**.

Une configuration `live` ne suffit pas à donner un effet juridique ou un droit financier. Les fonctionnalités du moteur Settings doivent rester `false`/indisponibles tant que leur mise en œuvre serveur et les validations requises ne sont pas livrées. Refus serveur systématique des opérations non admissibles.

## 3. Modèle de configuration proposé (NON créé en DB)

**Catalogue statique dans le code :**
`provider_catalog` (module statique, non saisissable dans l'UI) : `provider_id`, `domain`, `adapter_version`, `countries_supported`, `capabilities_supported`, `signature_levels` si pertinent, `status=implemented|candidate`.

**Tables proposées (à analyser avant migration additive séparée) :**

| Entité | Champs / règle | Exposition |
| --- | --- | --- |
| `provider_connections` | id UUID, provider_id allowlist, domain, legal_entity, market_country ISO, environment sandbox/live, status, secret_ref opaque, created_at | interne Admin ; jamais `secret_ref` exposé au navigateur |
| `provider_policies` | id, connexion, domaine/capacité, marché, `activation`, `is_default`, effective_from/to, version, expected_version, reason | DTO Admin expurgé, lecture serveur interne |
| `provider_events` | append-only, actor Admin, action, version avant/après non secrète, date, motif | audit Admin privé |
| `provider_operations` | id, domaine, contrat/award ou opération métier, provider_id + adapter_version + connection_id + environment **figés**, remote_ref chiffrée/privée, status, idempotency_key, correlation_id, created_at | serveur et preuves RLS par parties ; jamais d'identifiant fournisseur privé en listing |
| `provider_inbox_events` | id événement distant (unique scope provider), digest payload, état vérification, date, résultat de traitement, corrélation | interne append-only expurgé |
| `provider_artifacts` | operation, kind, Storage privé, hash SHA-256, provenance, validation, conservation | accès RLS aux parties selon preuve et document |

**Contraintes majeures :**
- Unique **choix effectif par** domaine × capacité × pays × entité juridique × environnement × intervalle de validité (contrainte transactionnelle/exclusion temporelle adaptée). Plusieurs prestataires possibles dans le registre, pas deux defaults simultanés.
- Un changement d'Admin concerne **les nouvelles opérations seulement**, jamais une session de signature ou un escrow actif. Les anciens prestataires restent consultables pour récupération, annulation, vérification et audit.
- Compare-and-swap `expected_version`, motif obligatoire, historique immuable, révision atomique et option « désactiver nouvelles opérations ».
- Aucun champ éditable permettant du SQL/JS arbitraire, un endpoint fournisseur à la volée, des JWT, OTP, certificats privés ou des paramètres d'élévation de privilèges.
- Le schéma proposé n'est pas un modèle de fonds bancaires. Ne pas déplacer les données de contrat ou le ledger existant.

## 4. Contrats TypeScript de conception (pseudotypes, non implémentés)

```ts
type ProviderDomain = 'signature' | 'escrow' | 'payment' | 'identity' | 'messaging';
type RuntimeMode = 'sandbox' | 'live';

type ProviderContext = Readonly<{
  operationId: string;           // généré côté serveur
  idempotencyKey: string;
  country: 'TN';                 // extensible par catalogue de marchés validés
  mode: RuntimeMode;
  connectionRef: string;         // référence opaque, PAS une clé API
}>;

type VerifiedProviderEvent = Readonly<{
  providerId: string;
  operationId: string;
  remoteEventId: string;
  eventType: string;
  validatedAt: string;
  evidenceDigest: string;
}>;

interface SignatureProvider {
  readonly id: string;
  readonly capabilities: ReadonlyArray<'sequential' | 'qualified' | 'simple' | 'evidence'>;
  createSession(input: Readonly<{
    contractId: string; versionId: string; pdfSha256: string;
    signers: readonly ['contractor', 'client'];
  }>, ctx: ProviderContext): Promise<{ providerSessionRef: string; nextAction: 'redirect' | 'iframe' | 'wait' }>;
  getSessionStatus(operationId: string, ctx: ProviderContext): Promise<'pending' | 'completed' | 'failed' | 'expired'>;
  retrieveSignedArtifacts(operationId: string, ctx: ProviderContext): Promise<{ pdf: Uint8Array; proof: Uint8Array }>;
  verifyAuthenticity(rawEvent: Uint8Array, signatureHeaders: Readonly<Record<string,string>>): Promise<VerifiedProviderEvent>;
}

interface EscrowProvider {
  readonly id: string;
  createEscrow(input: { externalBeneficiaryRef: string; amountMillimes: bigint; currency: 'TND' },
               ctx: ProviderContext): Promise<{ externalRef: string; state: 'pending' }>;
  getVerifiedStatus(operationId: string, ctx: ProviderContext): Promise<'pending' | 'funded' | 'held' | 'released' | 'refunded' | 'disputed'>;
  requestRelease(input: { operationId: string; amountMillimes: bigint; approvalRef: string },
                 ctx: ProviderContext): Promise<{ state: 'requested' }>;
  // Refund / dispute / evidence interfaces to be defined with selected regulated custodian.
}

interface PaymentProvider {
  readonly id: string;
  createPayment(input: { amountMillimes: bigint; currency: 'TND'; recipientRef: string },
                ctx: ProviderContext): Promise<{ paymentRef: string; state: 'pending' }>;
  getVerifiedStatus(operationId: string, ctx: ProviderContext): Promise<'pending' | 'paid' | 'failed' | 'reversed'>;
}
```

**Ces interfaces sont un contrat de conception, pas la preuve que ces méthodes existent dans les API NGSIGN, TunTrust ou d'un prestataire escrow.** Adapter les signatures des méthodes aux capacités documentées et testées *sans changer la sémantique métier D.A.O.*. `PaymentProvider` et `EscrowProvider` sont volontairement distincts. `verifyAuthenticity` représente l'obligation de contrôle ; si le fournisseur ne supporte pas de webhook signé, définir un protocole sûr de récupération/réconciliation serveur avant toute activation.

## 5. Sélection du fournisseur et politique de failover

`resolveProvider(domain, capability, country, legalEntity, mode)` retourne `Unavailable(reason_neutral)` ou un adaptateur **explicitement compilé**, éligible et activé. Avant le retour : autorisation Admin pour configuration, validité du marché, capacité réellement testée, contrat prestataire, contrôle secret côté serveur, statut actif et politique Settings.

- `sandbox` et `live` sont séparés physiquement/configuration, secrets et données. Les sessions sandbox ne deviennent jamais une preuve juridique live.
- Aucune sélection automatique du « moins cher » pour un dossier juridique/financier, aucun round-robin opaque.
- Un défaut de fournisseur n'entraîne **pas** un failover silencieux sur une signature déjà initiée ou une transaction financière. Un nouveau choix exige une transition métier explicite, l'abandon contrôlé de l'ancienne opération, la revalidation complète des parties et une nouvelle clé idempotente.
- Coupure du connecteur : **bloquer les nouvelles initiations**, conserver les tâches de vérification/reconciliation/restitution des opérations antérieures.

## 6. Signature électronique — séquence cible (P2.2-E)

1. D.A.O. vérifie les droits d'action, la configuration par chantier, les parties juridiques et les mandats, la version immuable courante et le PDF canonique + annexes, puis scelle le paquet et ses empreintes.
2. Il fixe **une fois** `provider_id`, `adapter_version`, `connection_id`, `contract_version_id` et `pdf_sha256` sur l'opération. Même document logique pour les deux signataires.
3. Après autorisation juridique et accès réel partenaire, il lance la session : **Artisan puis Client** en séquentiel (si validé en sandbox). Les liens iframe/redirection sont des moyens de présentation, jamais des preuves.
4. Callback authentifié + polling de réconciliation si pertinent ; vérifier statut, document, chaque signataire, certificat, chaîne, révocation, horodatage et journal probatoire **du document signé reçu**. Les garanties `simple` / `qualified` sont **par opération**, selon preuve du fournisseur et analyse juridique, non présumées par sa marque.
5. L'Admin D.A.O. habilité contrôle ensuite les documents et valide distinctement ; cette validation **n'est pas une troisième signature**. `signed` et `legal_effect_enabled` restent fermés jusqu'au feu vert juridique et au service d'attestation cryptographique.
6. Archivage immuable PDF signé + journal / fichier de preuve + hashes, stockage privé et vérification ultérieure. Jamais de PIN/OTP/token dans les traces. En cas d'échec partiel, ne pas changer la version, ne pas inventer la signature manquante, ne pas déclencher de paiement.

**NGSIGN :** courriel fournisseur du 26/10 transmis par le propriétaire : circuit multipartite annoncé, API REST simplifiée, iframe ou redirection, sandbox 40 jours **proposée**. La documentation avancée, les clés de test, la syntaxe/signature des callbacks, la preuve PDF, les tarifs et la validation juridique sont **à obtenir/essayer**. Ne pas transformer des affirmations commerciales en garanties techniques déjà vérifiées. TunTrust/DigiGO et autres intégrateurs restent des candidats.

## 7. Escrow/séquestre — obligations spécifiques

- `EscrowProvider` n'est implémentable et activable qu'avec une banque/entité ou solution **juridiquement habilitée à détenir et administrer les fonds** dans le pays visé, contractualisée et validée par un juriste/experts conformité.
- D.A.O. **ne détient pas les fonds** du simple fait qu'il affiche un solde. Le ledger interne journalise les événements attestés et rapproche les mouvements, avec montants TND millimes et références auditables.
- **`funded` ≠ `held` ≠ `release_requested` ≠ `released` ≠ `refunded` ≠ `disputed`**. Un échéancier, une facture, une réception, une signature ou une validation technique ne déclenchent aucune libération par défaut.
- Libération exige une demande autorisée distincte, des contrôles contractuels et fournisseur, confirmation distante vérifiée, puis rapprochement. Retours/arbitrages/litiges/chargebacks et reprises d'incident exigent des cas métier explicites.
- Statuts et API exacts à spécifier **avec le prestataire choisi** ; pas de pseudo-escrow fondé sur une table Supabase ou sur le portefeuille de D.A.O.
- Aucun KYC/AML, encaissement, versement ni remboursement réel sans dossier légal/pays/consentement et GO distinct.

## 8. UX Admin (maquette textuelle, pas une UI livrée)

**Admin → Paramètres → Intégrations & prestataires**

```text
Intégrations & prestataires              Marché : Tunisie ▼
[Signature] [Séquestre] [Paiements] [Identité] [Communication]

SIGNATURE
● NGSIGN        Candidat       Sandbox proposée    [Voir prérequis]
○ TunTrust      Candidat       Non configuré       [Voir prérequis]
Fournisseur actif : AUCUN — Signature réelle désactivée
[Consulter les capacités] [Historique] [Tester connexion (si autorisé)]

SÉQUESTRE
● Aucun prestataire habilité confirmé
Fonds conservés chez : N/A           Statut : Non disponible
[Voir prérequis légaux et techniques]
```

Chaque fiche affiche seulement : pays, fournisseur, environnements disponibles, capacités réelles, prérequis manquants, dernière validation de santé, mode, provenance et historique. Toute mutation exige action Admin et motif, confirmation, audit, version attendue. **Aucun formulaire « saisir clé API » en clair, aucun faux bouton actif, aucun accès Gestionnaire à l'activation juridique/financière.**

Côté Client/Artisan, si `disabled`, afficher « Signature électronique indisponible » / « Séquestre non disponible », pas « signé », « garanti », « payé » ou « fonds sécurisés » sur de simples déclarations.

## 9. Matrice sécurité et recette avant toute activation

| Scénario | Résultat attendu |
| --- | --- |
| Aucun connecteur / réglage désactivé | nouvelles opérations refusées, dossiers consultables |
| Mauvais rôle / autre Client / Artisan concurrent | refus JWT/RLS, aucune fuite de preuve |
| Double rôle Client+Artisan | espace et partie actifs contrôlés, pas d'auto-signature ambiguë |
| PDF altéré ou version de contrat remplacée | refus signature / verrouillage nouvelle version |
| Deux callbacks identiques ou hors ordre | idempotence, état final monotone |
| Callback forgé, expiration, clé fournisseur révoquée | refus sans mutation métier engageante |
| Succès redirect web mais preuve fournisseur absente | `pending`, jamais `signed` |
| Changement de default après session lancée | ancienne session reste attachée à ancien prestataire |
| Prestataire offline | blocage nouvelles opérations, retry/réconciliation bornés |
| Contestation et échec release/refund escrow | pas de faux statut `released`, journal + réconciliation |
| Admin révoqué / staff non mandaté | aucune édition config ni validation finale |
| Sandbox accidentellement ciblée par flux live | échec fermé, aucun mélange credentials/preuves |
| Secrets/API keys et fichiers de preuve | absents des DTO publics, traces et commits |

Exiger tests unitaires interfaces/fake providers en local, tests d'intégration isolés, négatifs RLS/Auth, E2E mobile/desktop, contrôle d'API et contrats réels **uniquement après** sandbox/provider et validations adaptées. Trois checks GitHub et `deploy-dev` conservés sur les PR de code ultérieures.

## 10. Découpage et conditions GO

- **I0 (ce document)** : architecture, vocabulaire, interface conceptuelle et prérequis. Autorisé sans mutations SQL, secrets ni services externes.
- **I1 (signature)** : adaptateur NGSIGN sandbox + tests (éventuellement TunTrust après comparaison), intégration avec #383 ; clés et documentation approfondie nécessaires. Première livraison **technique sandbox** sans effet juridique. Activation live exige juriste tunisien, identification/mandats, validité du niveau de signature et preuves.
- **I2 (escrow)** : identification d'un partenaire habilité en Tunisie, modèle de séquestre, conformité et flux exacts ; les API et le code d'exécution attendent contrat et GO spécifique.
- **I3 (paiements)** : indépendant de I2 ; prestataire, opérations, remboursements, rapprochement et contrôles.
- **I4 (autres)** : identité, SMS, géocodage, archivage, extension MENA avec disponibilité de pays.
- Les migrations, pages Admin et commandes réelles feront l'objet d'une **mission technique distincte**, coordonnée avec Settings #423. Aucun développement S5 via la seule issue #505.

**État des décisions à la date de ce document :** fournisseur NGSIGN **candidat** ; sandbox **proposée, clés non reçues** ; TunTrust alternatif **non sélectionné** ; escrow **aucun prestataire légalement validé** ; signatures et transactions financières live **non disponibles**.

## 11. Questions encore ouvertes (ne pas inventer de réponse)

1. NGSign : API avancée, signature/certification des callbacks, retry/polling, PAdES, preuve d'identité, horodatage, conservation, environnements et prix par signature.
2. Juriste : type de signature pour Client particulier/entreprise, Artisan indépendant/entreprise, mandat LogicLab Tunisie, opposabilité et conservation.
3. Escrow : acteur habilité en Tunisie, nature exacte du compte séquestre, mandats de libération, gestion des litiges et rapprochement.
4. Product : règle de sélection par société/segment au lancement et éventuel basculement manuel future opération, sans changement rétroactif.
5. Staff : besoin de double validation Admin pour basculer de `sandbox` à `live`; à arbitrer avant exécution.

---

**Owner du cadrage :** issue [#505](https://github.com/Khaey/Dao/issues/505), revue PILOT 12. Pas de remplacement des responsabilités #423/#383.