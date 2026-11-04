# Moteur de métrés BTP déterministe (#548)

## Frontière métier

Le moteur produit des **métrés prévisionnels** à partir des modèles publiés du référentiel BTP.
Il ne modifie jamais les quantités d’exécution, situations de travaux, offres/devis, contrats,
prix ou plannings OCE. Il n’interprète aucun plan et n’applique aucun coefficient implicite.

Chaque dossier est identifié par `(chantier, ouvrage canonique, scopeKey)`. Le `scopeKey` distingue
plusieurs géométries du même ouvrage, par exemple `mur-nord` et `mur-sud`.

## Entrées et calcul

Chaque entrée contient une valeur décimale sous forme de chaîne, une unité et une provenance :

```json
{
  "length_m": {
    "value": "1000",
    "unit": "cm",
    "source": { "kind": "document", "reference": "Plan A-12" }
  }
}
```

Provenances admises : `manual`, `document`, `survey`, `bim_import`. Cette dernière prépare un futur
adaptateur BIM mais ne signifie pas que D.A.O. sait lire ou interpréter le fichier.

Conversions V1 : `mm|cm|m → m`, `mm2|cm2|m2 → m2`, `cm3|l|m3 → m3` et `unit → unit`.
Le calcul TypeScript emploie des décimaux exacts ; PostgreSQL recalcule indépendamment l’AST publié
avant écriture. Seules `identity`, `multiply` (deux ou trois termes) et `subtract` sont autorisées.
La soustraction refuse une déduction supérieure à la quantité brute.

Si une dimension requise manque, la révision porte `insufficient_data`, la liste exacte des champs
et une question ciblée. Elle ne contient aucun résultat.

## Justificatif et révisions

Une révision immuable conserve : modèle/formule et version du catalogue, entrées originales et
normalisées, provenance, étapes, valeur brute, arrondi, unité, hypothèses, source éditoriale et
empreintes SHA-256. Un recalcul crée toujours une nouvelle révision.

Cycle : `draft → submitted → validated`. Le Client propriétaire ou le Gestionnaire peut calculer et
soumettre ; seul un Gestionnaire/Admin habilité au chantier valide. Un recalcul après validation
repasse le dossier en brouillon et conserve la révision validée précédente pour comparaison.

## API

- `GET /api/btp/takeoffs?project_id=<uuid>[&takeoff_id=<uuid>]`
- `POST /api/btp/takeoffs`
  - `action=calculate` : chantier, ouvrage, périmètre, libellé, entrées, clé idempotente ;
  - `action=submit|validate` : dossier, révision attendue, note facultative, clé idempotente.

JWT obligatoire, réponses `private, no-store`. Les tables publiques sont en lecture RLS et sans
droit d’écriture `authenticated`. Les commandes privées vérifient `auth.uid()`, le chantier et le
rôle ; les clés idempotentes ne peuvent pas être réutilisées avec un autre payload.

## Limites V1

Seuls les cinq modèles `TN-2026.1` sont calculables. Aucune perte, norme, quantité structurelle,
prix, durée ou conformité n’est déduite. Les fondations/structures sans modèle publié restent
explicitement non calculables.
