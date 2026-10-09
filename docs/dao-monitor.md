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
- Toute nouvelle mission/agent se déclare par PR révisée dans le registre.

## Alertes automatiques

- Commentaire de checkpoint qualifié d'un agent DEV, OPT ou Pilot.
- Fusion d'une PR vers main. La notification affiche l'**agent responsable**
  et son issue, trouvés dans le titre ou dans la référence de mission de la PR.
- CI/déploiement workflow principal sur main : réussite ou échec. L'agent
  est déterminé seulement si le SHA du run correspond exactement au
  merge_commit_sha d'une unique PR fusionnée vers main, puis à son issue.
- Quand la référence est absente ou ambiguë, le message porte explicitement
  « Agent : non identifié », sans inventer de responsable. Ajouter "Refs #N"
  sur les PR, avec N = issue propriétaire, et maintenir le registre d'agents
  à jour au moment des transferts. Le merger ou l'auteur Git ne prouve pas
  l'identité de l'agent.

- Surveillance des seules missions explicitement ACTIVE : évaluation environ
  toutes les 15 minutes, seuil 90 minutes depuis le dernier checkpoint.
  Une seule alerte prudente par checkpoint ACTIVE, dédoublonnée par commentaire
  machine sur l'issue. On n'affirme **jamais** avoir détecté un crash/quota.

Les missions passives (dont Pilot 3 #89 et ancien OPT #85) ne déclenchent
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

La configuration des deux secrets GitHub et la réception du test réel restent
l'unique étape propriétaire requise. Pas de connexion SSH.
