# D.A.O — Architecture visuelle C4 / Structurizr

Ce dossier contient le **modèle d'architecture visuelle vivant** de D.A.O.

La source de vérité visuelle est :

```text
docs/architecture/workspace.dsl
```

Le modèle suit C4 et produit plusieurs vues à partir du même modèle :

- **Landscape** — vue globale acteurs + D.A.O + dépendances externes ;
- **SystemContext** — contexte fonctionnel de D.A.O ;
- **Containers** — architecture runtime ;
- **WebComponents** — grands domaines fonctionnels ;
- **ClientProjectFlow** — préparation d'un chantier ;
- **InvitationFlow** — invitation artisan/entreprise ;
- **ManagerReviewFlow** — revue Gestionnaire ;
- **DevDeployment** — déploiement DEV actuel.

## Ouvrir la vue visuelle

Structurizr `local` est la voie recommandée actuelle pour consulter/modifier
le modèle localement. Il lit directement `workspace.dsl` et expose la vue
uniquement sur localhost.

Depuis la racine du dépôt, avec Docker :

### Linux / macOS / Git Bash

```bash
docker pull structurizr/structurizr
docker run --rm -it -p 8080:8080 \
  -v "$(pwd)/docs/architecture:/usr/local/structurizr" \
  structurizr/structurizr local
```

### Windows PowerShell

```powershell
docker pull structurizr/structurizr
docker run --rm -it -p 8080:8080 `
  -v "${PWD}/docs/architecture:/usr/local/structurizr" `
  structurizr/structurizr local
```

Puis ouvrir :

```text
http://localhost:8080
```

## Règle de maintenance

Une modification doit mettre à jour `workspace.dsl` dans la même PR lorsqu'elle
change de manière significative :

- un acteur ou rôle ;
- un domaine fonctionnel majeur ;
- un système externe ou fournisseur ;
- un conteneur/runtime ;
- un flux métier structurant ;
- le modèle de déploiement ;
- une frontière d'autorisation importante.

Les modifications purement UI, correctifs locaux et changements sans impact
architectural n'exigent pas une modification du diagramme.

Cette règle s'applique à WORK DEV comme à WORK OPT : lorsqu'une PR modifie
l'architecture dans l'un des cas ci-dessus, cette même PR doit mettre à jour
`docs/architecture/workspace.dsl`. La mise à jour ne doit pas être reportée
à une PR ultérieure sauf instruction explicite de l'utilisateur.

## Publication automatique

Après merge sur `main`, le workflow GitHub Actions
`D.A.O Architecture Pages` :

1. valide le modèle Structurizr ;
2. régénère le site HTML interactif ;
3. publie automatiquement la nouvelle version sur GitHub Pages.

Vue publiée :

`https://khaey.github.io/Dao/`

La publication web est donc automatique après merge ; seule la mise à jour du
modèle reste une responsabilité explicite de la PR qui introduit le changement
architectural.

## Ce que le diagramme ne remplace pas

Le modèle C4 donne une **vision globale**. Les règles détaillées restent dans
`docs/ai-context/`, les migrations SQL/RLS restent dans le code et GitHub
`main` reste la source de vérité technique.

Ne jamais représenter une fonctionnalité future comme déjà opérationnelle.
Les capacités futures doivent être clairement décrites comme futures avant
d'être ajoutées aux vues runtime actuelles.
