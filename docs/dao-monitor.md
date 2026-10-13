# DAO Monitor — GitHub vers Telegram (#93)

Bot public : https://t.me/DAOAlertsbot

V1 : notifications **sortantes uniquement**, par GitHub Actions. Aucun processus
sur le VPS. La surveillance ne peut pas observer l'état interne d'une session
ChatGPT Work, seulement les événements publiés dans GitHub.

## Activation une fois, sans terminal VPS

1. Ouvrir le bot Telegram, lui écrire /start.
2. Conserver le token BotFather exclusivement dans un gestionnaire privé.
3. GitHub Khaey/Dao → Settings → Environments → **dev** → Environment secrets :
   - DAO_MONITOR_TELEGRAM_BOT_TOKEN : valeur privée fournie par BotFather ;
   - DAO_MONITOR_TELEGRAM_CHAT_ID : ID de la conversation Telegram destinataire.
4. Obtenir son chat ID en privé depuis l'application Telegram ou un bot
   d'identification reconnu ; ne jamais le publier dans une issue, capture ou
   conversation ChatGPT, et ne jamais afficher de réponse getUpdates contenant
   des données personnelles.
5. Après fusion de la PR, ouvrir
   https://github.com/Khaey/Dao/actions/workflows/dao-monitor.yml
   puis Run workflow sur main et confirmer la réception effective du message
   de test. Sans réception, le système n'est **pas** opérationnel.

## Checkpoint explicite des agents

Dans l'issue propriétaire, publier un commentaire contenant *uniquement* :

    DAO_MONITOR_V1
    agent: DAO DEV 20
    status: BLOCKED
    summary: Attente d'autorisation administrateur

Le nom d'agent doit correspondre à l'issue dans
.github/dao-monitor-agents.json. Les états acceptés sont ACTIVE, BLOCKED,
WAITING_HUMAN, PAUSED_QUOTA, HANDOFF, DONE, DECISION.

- Les checkpoints ACTIVE servent de heartbeat, mais ne produisent pas d'alerte immédiate.
- Les six autres états déclenchent des alertes immédiates Telegram.
- Les commentaires libres historiques ne déclenchent pas de faux états.
- Les auteurs sont vérifiés contre la liste d'identités autorisées.
- Toute nouvelle mission/agent se déclare par PR révisée dans le registre. Une\n  fusion sur main déclenche automatiquement une annonce Telegram de l'agent\n  et de son issue, sans exposition de secrets.

## Inscription obligatoire des nouveaux agents (Pilot 4)

**À effectuer lors de la création d'un agent, avant ses premières PR métier :**

1. Définir son nom officiel unique (par exemple `DAO Chat 20`), son mode
   Chat/Work, sa mission canonique GitHub et son owner Pilot.
2. Ajouter l'association `issue / agent / role` dans
   `.github/dao-monitor-agents.json` au sein d'une petite PR de registre,
   distincte des travaux des autres agents. Mettre `watchdog: true` uniquement
   pour une mission réellement suivie : cela ne déclenche une surveillance
   qu'après un checkpoint structuré `ACTIVE`.
3. Faire valider/fusionner la PR avec les tests du Monitor. Le push sur `main`
   qui modifie le registre déclenche automatiquement **une notification Telegram**
   regroupant les nouveaux agents/associations (`DAOAlertsbot`). Le script lit
   les deux révisions exactes de GitHub : il n'envoie pas de message en cas de
   modification sans nouvel agent/mission.
4. Vérifier l'exécution GitHub Actions de `DAO Monitor` et la réception du
   message sur le canal existant. Sans succès prouvé, l'inscription est
   **en attente**, même si le fichier est fusionné.
5. Tout renommage ou transfert d'issue doit mettre à jour le registre ; les
   missions terminées sont conservées pour l'attribution historique, mais leur
   `watchdog` doit être désactivé.

**Limite fondamentale :** ChatGPT Chat/Work ne fournit pas au dépôt GitHub
d'événement de création de conversation. Aucune détection automatique d'une
nouvelle session ChatGPT n'est promise. Le déclencheur fiable est
**l'enregistrement GitHub**, pas la création de l'onglet ChatGPT. Cette
intégration permet de router les alertes vers le **canal Telegram D.A.O
existant** ; elle n'ajoute pas un utilisateur humain à un groupe Telegram
et ne crée pas de nouveaux bots ou de nouveaux tokens.

**Référentiel actualisé :** `#64 → DAO Chat 20`, `#124 → DAO OPT 20`,
`#125 → DAO DEV 2`, `#89/#93 → DAO Pilot 4`. `#61` est suivi en cadrage
par Pilot 4 ; `#83` et `#91` restent historiques/passifs. Aucune émission
rétroactive des anciennes alertes ni création artificielle de checkpoint ACTIVE.

## Alertes automatiques

- Commentaire de checkpoint qualifié d'un agent DEV, OPT ou Pilot.
- Fusion d'une PR vers main. La notification affiche l'**agent responsable**
  et son issue, trouvés dans le titre ou dans la référence de mission de la PR.
- CI/déploiement workflow principal sur main : réussite ou échec. L'agent
  est déterminé seulement si le SHA du run correspond exactement au
  merge_commit_sha d'une unique PR fusionnée vers main, puis à son issue.
- L'attribution reconnaît aussi la mention française `Réfs #N` et le lien
  canonique vers l'issue propriétaire (`github.com/Khaey/Dao/issues/N`).
  Ainsi, une description qui cite d'autres PR/CI n'efface pas son propriétaire.
- Les numéros PR/CI du titre qui ne correspondent à aucune mission enregistrée
  n'empêchent pas la lecture de la référence propriétaire du corps. Des missions
  enregistrées contradictoires dans le titre restent ambiguës.
- Les références citées dans du code Markdown (en ligne ou bloc à trois
  backticks) sont des exemples, pas des déclarations de propriétaire. Écrire
  la référence canonique `Refs #N` en texte normal hors de ces exemples.
- Quand la référence est absente, non fiable ou ambiguë, le message porte
  « Attribution à confirmer — PR #N » si la PR est connue, sans inventer de
  responsable. Le merger ou l'auteur Git ne prouve pas l'identité de l'agent.

## Déclarer le propriétaire d'une PR (#120)

Dans le corps de chaque nouvelle PR, écrire sur une ligne en texte normal :

    Owner issue: #120

Remplacer 120 par l'issue canonique du chantier ; le template PR et AGENTS.md
rappellent cette convention. Le nom affiché vient exclusivement du registre
révisé, jamais d'un champ libre « Agent » ou « Owner ». Le compte GitHub partagé
ne permet pas de distinguer les agents.

- La déclaration explicite désigne la propriété de **cette PR**. Ses autres
  liens d'issues et numéros de titre sont du contexte. Une PR transversale du
  Pilot déclare `Owner issue: #89`, même si elle cite #115 et #116.
- Plusieurs déclarations identiques sont acceptées. Deux issues propriétaires
  différentes, un owner inconnu, ou un `Refs`/`Réfs`/`Fixes`/`Closes`/`Resolves`
  contradictoire restent ambigus. Une liste de références incompatibles n'est
  pas résolue par la première entrée.
- Sans cette ligne, les références historiques restent reconnues : titre,
  déclaration Refs/closing, lien canonique puis référence unique du corps.
  Les conflits entre mission du titre et déclaration Refs ne sont pas ignorés.
- Code Markdown (backticks, tildes, blocs non fermés ou indentés), citations
  et commentaires HTML ne déclarent aucun propriétaire.
- Une attribution exige une PR de ce dépôt, créée par une identité déjà
  autorisée dans `allowed_comment_authors`, et une issue enregistrée.
  Les métadonnées d'un fork ou d'un auteur extérieur restent indéterminées.
  La liste des auteurs autorisés et les permissions Actions restent inchangées.
- La CI reste liée uniquement au SHA exact d'une unique PR fusionnée vers main.
  Les logs exposent seulement l'attribution résolue et le résultat Telegram,
  jamais le corps de PR, le token ou le destinataire.

Le registre couvre désormais aussi #64 (DAO Chat 20), #124 (DAO OPT 20),
#125 (DAO DEV 2) et la reprise Pilot 4 sur #89/#93. `OPT` reste distinct de
`DAO OPT 20`. Les historiques #83/#91 restent présents mais ne lancent plus
de watchdog. Aucun état ACTIVE ni nouvelle session ChatGPT n'est créé.

Les fixtures conservent les corps GitHub complets de #107/#108/#117/#118/#119
et les événements CI exacts de #117/#118/#119. #117 se résout vers #112 ; les
corps historiques #118/#119 ne déclarent pas #89 et restent prudents. Les tests
de leur future déclaration explicite prouvent la séparation du contexte.
Aucune ancienne alerte n'est réémise et aucun corps de PR d'un autre agent
n'est modifié. Les messages déjà reçus ne changent pas rétroactivement.

## Surveillance explicite existante

- Surveillance des seules missions explicitement ACTIVE : évaluation environ
  toutes les 15 minutes, seuil 90 minutes depuis le dernier checkpoint.
  Une seule alerte prudente par checkpoint ACTIVE, dédoublonnée par commentaire
  machine sur l'issue. On n'affirme **jamais** avoir détecté un crash/quota.

  Seul un commentaire de `github-actions[bot]` (type Bot), dont la première
  ligne correspond exactement au marqueur du checkpoint ACTIVE concerné,
  acquitte l'alerte. Une citation, un auteur différent ou un autre identifiant
  ne peut pas supprimer une alerte. Un nouveau checkpoint ACTIVE ouvre une
  nouvelle période de surveillance ; son ancien acquittement ne la masque pas.

Les missions passives (dont Pilot 3 #89 et OPT #85) ne déclenchent
pas d'alerte d'inactivité. #91 est inscrite mais ne devient ACTIVE
qu'après un checkpoint explicite.

## Limites et protection

- L'issue GitHub ne démarre pas une session Work ni une notification à elle seule.
- La latence des workflows GitHub est variable : quasi temps réel, pas instantané.
- Un Work arrêté avant son commit/checkpoint n'émet pas d'événement observable.
- Certains commentaires produits par GITHUB_TOKEN n'activent pas d'autres Actions ;
  qualifier un vrai commentaire provenant du connecteur.
- Aucune commande, script, champ d'une PR ou d'un commentaire ne s'exécute.
- Le code des notifications se charge depuis main, pas depuis une PR non fiable.
- Les tests de PR n'ont aucun secret Telegram.
- Le module supprime les URL/détails des erreurs HTTP Telegram contenant le token.
- Le watchdog crée un commentaire machine pour mémoriser l'alerte. Une coupure
  entre acceptation Telegram et écriture du commentaire pourrait produire
  une notification répétée ; l'exactement-une-fois n'est pas garanti.

Tests locaux (sans token ni appels réseau) :

    python3 -m unittest discover -s tests -p test_dao_monitor.py -v

Les deux secrets existants ne sont ni lus ni changés par #120. La qualification
de livraison utilise les événements normaux de sa PR/CI, sans dispatch de test,
faux blocage ni connexion SSH. Le succès Telegram dans les logs établit
l'acceptation par l'API ; l'affichage effectif dans l'application reste distinct.

