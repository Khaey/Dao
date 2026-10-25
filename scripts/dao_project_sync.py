#!/usr/bin/env python3
"""Sync DAO Project #3 from repo issues/PRs and canonical agent registry.
Requires DAO_PROJECTS_TOKEN classic PAT scoped project+repo in Actions Secrets.
A merge/closed issue never independently proves DEV deployment.
The board never claims an AI agent is running based on PR or issue metadata.
"""
import argparse
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

REPO = "Khaey/Dao"
API = "https://api.github.com"
GRAPHQL = API + "/graphql"
OPTIONS = {
    "Agent": ["DAO Pilot 5", "DAO Chat 1", "DAO Chat 20", "DAO DEV 1", "DAO DEV 2",
              "DAO DEV 20", "DAO OPT 2", "DAO OPT 3", "DAO OPT 20", "DAO AUD 1", "DAO AUD 2", "DAO Settings", "DAO UX Admin", "DAO DEV 4", "DAO Pilot 4",
              "DAO Pilot 6", "DAO Pilot 7", "DAO CoPilot 1", "DAO COP", "DAO DOW",
              "DAO TOW", "DAO Chat 21", "DAO Pilot 10", "DAO CH2", "DAO CoPilot 4",
              "OPT", "Non attribué"],
    "Priorité": ["P0", "P1", "P2", "P3", "Non définie"],
    "Domaine": ["Client", "Artisan", "Gestionnaire", "Contrats", "OPS/Infra",
                 "Monitoring", "Produit/UX", "Pilotage", "Autre"],
}
COLORS = ("BLUE", "GREEN", "ORANGE", "PURPLE", "PINK", "YELLOW", "RED", "GRAY")


def owner_issue(body):
    match = re.search(r"(?im)^\s*Owner issue:\s*#(\d+)\s*$", body or "")
    return int(match.group(1)) if match else None


def priority(item):
    found = re.search(r"(?<!\w)P([0-3])(?![\w.])", item.get("title") or "", re.I)
    if found:
        return "P" + found.group(1)
    for label in item.get("labels") or []:
        name = label if isinstance(label, str) else label.get("name", "")
        tagged = re.search(r"(?<!\w)P([0-3])(?!\w)", name, re.I)
        if tagged:
            return "P" + tagged.group(1)
    return "Non définie"


def domain(item):
    name = (item.get("title") or "").lower()
    groups = (
        ("Monitoring", ("monitor", "telegram")),
        ("OPS/Infra", ("vps", "cloudflare", "oce ", "ops ", "deploy", "backup")),
        ("Contrats", ("contrat", "contract", "signature", "attribution")),
        ("Gestionnaire", ("back-office", "backoffice", "gestionnaire")),
        ("Client", ("client", "annuaire", "mes chantiers")),
        ("Artisan", ("artisan", "contractor", "profil pro", "professionnel")),
        ("Pilotage", ("pilot ", "passation", "handoff")),
        ("Produit/UX", ("ux", "paramètre", "settings", "accueil", "e2e")),
    )
    return next((g for g, words in groups if any(w in name for w in words)), "Autre")


# Status reflects recent GitHub delivery evidence, not a live AI agent session.
# Never retain an old In Progress value without current evidence.
ACTIVE_HOURS = 72


def recently_updated(item, now=None):
    value = item.get("updated_at")
    if not value:
        return False
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            return False
    except (TypeError, ValueError, AttributeError):
        return False
    age = (now or datetime.now(timezone.utc)) - stamp
    return timedelta(0) <= age <= timedelta(hours=ACTIVE_HOURS)


def explicit_active(item):
    return any((v if isinstance(v, str) else v.get("name", "")).casefold()
               in ("dao:active", "dao:in-progress") for v in item.get("labels") or [])


def status(item, open_linked_pr=False, now=None):
    if item.get("pull_request"):
        if item.get("state") == "closed" or item.get("merged_at"):
            return "Done"  # closed unmerged = workflow finished, not delivered
        if item.get("draft") or not recently_updated(item, now):
            return "Todo"
        return "In Progress"
    if item.get("state") == "closed":
        return "Done"
    # Avoid double-counting an active PR and its owner issue.
    if open_linked_pr:
        return "Todo"
    if explicit_active(item) and recently_updated(item, now):
        return "In Progress"
    return "Todo"


def evidence(item, open_linked_pr=False, linked_pr=None, now=None):
    if item.get("pull_request"):
        if item.get("merged_at"):
            return "PR fusionnée ; déploiement DEV non attesté par le seul merge"
        if item.get("state") == "closed":
            return "PR fermée sans fusion ; non livrée"
        if item.get("draft"):
            return "PR DRAFT / bloquée, pas de travail actif attesté"
        if not recently_updated(item, now):
            return "PR ouverte, sans activité GitHub depuis plus de 72h ; à requalifier"
        return "PR ouverte et mise à jour récemment ; activité agent non attestée"
    if item.get("state") == "closed":
        if item.get("state_reason") in ("duplicate", "not_planned"):
            return "Issue close (doublon/abandonnée) ; non livrée"
        return "Issue close ; vérifier la preuve du déploiement"
    if open_linked_pr:
        return "Issue suivie dans la PR ouverte #" + str(linked_pr) + " ; non comptée deux fois"
    if explicit_active(item) and recently_updated(item, now):
        return "Issue explicitement active <72h ; session agent non attestée"
    return "Issue ouverte : backlog / attente, pas d'activité prouvée"

class Github:
    def __init__(self, token):
        self.token = token

    def request(self, url, body=None):
        headers = {
            "Authorization": "Bearer " + self.token,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "DAO-projects-sync",
        }
        data = json.dumps(body).encode() if body is not None else None
        req = Request(url, headers=headers, data=data,
                      method="POST" if data is not None else "GET")
        try:
            with urlopen(req, timeout=30) as response:
                result = json.load(response)
        except HTTPError as exc:
            raise RuntimeError("GitHub HTTP %s" % exc.code) from None
        except URLError:
            raise RuntimeError("GitHub connection failure") from None
        time.sleep(.85)  # Protect GitHub's secondary mutation rate limits
        return result

    def graphql(self, query, **variables):
        result = self.request(GRAPHQL, {"query": query, "variables": variables})
        if result.get("errors"):
            raise RuntimeError("GitHub GraphQL: " +
                               "; ".join(str(e.get("message", "error"))[:180]
                                         for e in result["errors"]))
        return result["data"]

    def paged(self, path):
        page = 1
        while True:
            url = API + path + ("&" if "?" in path else "?") + "per_page=100&page=%d" % page
            rows = self.request(url)
            if not isinstance(rows, list):
                raise RuntimeError("Unexpected GitHub REST result")
            yield from rows
            if len(rows) != 100:
                break
            page += 1


PROJECT_QUERY = """
query($login:String!,$number:Int!){
 user(login:$login){projectV2(number:$number){
  id title
  fields(first:100){nodes{
   ... on ProjectV2Field{id name}
   ... on ProjectV2SingleSelectField{id name options{id name color description}}
  }}
 }}
}"""
ITEMS_QUERY = """
query($login:String!,$number:Int!,$after:String){
 user(login:$login){projectV2(number:$number){
  items(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{
   id content{
    __typename
    ... on Issue{number repository{nameWithOwner}}
    ... on PullRequest{number repository{nameWithOwner}}
   }
   s:fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}
   a:fieldValueByName(name:"Agent"){... on ProjectV2ItemFieldSingleSelectValue{name}}
   p:fieldValueByName(name:"Priorité"){... on ProjectV2ItemFieldSingleSelectValue{name}}
   d:fieldValueByName(name:"Domaine"){... on ProjectV2ItemFieldSingleSelectValue{name}}
   e:fieldValueByName(name:"État GitHub"){... on ProjectV2ItemFieldTextValue{text}}
  }}
 }}
}"""
CREATE = """mutation($input:CreateProjectV2FieldInput!){
 createProjectV2Field(input:$input){projectV2Field{
  ... on ProjectV2Field{id name}
  ... on ProjectV2SingleSelectField{id name options{id name}}
 }}
}"""
ADD = """mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}"""
UPDATE_FIELD = """mutation($input:UpdateProjectV2FieldInput!){
 updateProjectV2Field(input:$input){projectV2Field{
  ... on ProjectV2SingleSelectField{id name options{id name}}
 }}
}"""
SET = """mutation($input:UpdateProjectV2ItemFieldValueInput!){
 updateProjectV2ItemFieldValue(input:$input){projectV2Item{id}}
}"""


def get_project(g, login, number):
    data = g.graphql(PROJECT_QUERY, login=login, number=number)
    project = (data.get("user") or {}).get("projectV2")
    if not project:
        raise RuntimeError("GitHub Project not accessible with given token")
    fields = {f["name"]: f for f in project["fields"]["nodes"] if f and f.get("name")}
    if "Status" not in fields:
        raise RuntimeError("Project Status field is missing")
    for required in ("Agent", "Priorité", "Domaine"):
        if required in fields and not fields[required].get("options"):
            raise RuntimeError(f"Project field {required} is not a selectable field")
    return project["id"], fields


def create_fields(g, project_id, fields):
    for field_name, names in OPTIONS.items():
        if field_name not in fields:
            opts = [{"name": n, "description": n, "color": COLORS[i % len(COLORS)]}
                    for i, n in enumerate(names)]
            g.graphql(CREATE, input={"projectId": project_id, "name": field_name,
                                     "dataType": "SINGLE_SELECT", "singleSelectOptions": opts})
    # GitHub does not append missing options automatically to existing fields.
    # Preserve every existing option ID to avoid clearing assignments.
    for field_name, expected in OPTIONS.items():
        field = fields.get(field_name)
        if not field:
            continue
        existing = field.get("options") or []
        known = {option["name"].casefold() for option in existing}
        missing = [name for name in expected if name.casefold() not in known]
        if missing:
            options = [
                {"id": option["id"], "name": option["name"],
                 "color": option.get("color") or "GRAY",
                 "description": option.get("description") or ""}
                for option in existing
            ]
            options.extend({"name": name, "color": "GRAY", "description": name}
                           for name in missing)
            g.graphql(UPDATE_FIELD, input={"fieldId": field["id"],
                                           "singleSelectOptions": options})
    if "État GitHub" not in fields:
        g.graphql(CREATE, input={"projectId": project_id, "name": "État GitHub",
                                 "dataType": "TEXT"})


def read_items(g, login, number):
    result = {}
    cursor = None
    while True:
        chunk = g.graphql(ITEMS_QUERY, login=login, number=number, after=cursor)["user"]["projectV2"]["items"]
        for row in chunk["nodes"]:
            c = row.get("content") or {}
            if c.get("repository", {}).get("nameWithOwner") != REPO:
                continue
            typ = c.get("__typename")
            if typ in ("Issue", "PullRequest"):
                result[("pr" if typ == "PullRequest" else "issue", c["number"])] = row
        page = chunk["pageInfo"]
        if not page["hasNextPage"]:
            return result
        cursor = page["endCursor"]


def set_field(g, project, row, fields, key, target, dry_run):
    if target is None or key not in fields:
        return False
    source = {"Status": "s", "Agent": "a", "Priorité": "p",
              "Domaine": "d", "État GitHub": "e"}[key]
    current = (row.get(source) or {}).get("text" if key == "État GitHub" else "name")
    if current == target:
        return False
    if key == "État GitHub":
        value = {"text": target}
    else:
        option = next((opt for opt in fields[key].get("options", [])
                       if opt["name"].lower() == target.lower()), None)
        if option is None:
            raise RuntimeError(f"Project field {key}: missing option for {target!r}")
        value = {"singleSelectOptionId": option["id"]}
    if not dry_run:
        g.graphql(SET, input={"projectId": project, "itemId": row["id"],
                              "fieldId": fields[key]["id"], "value": value})
    return True


def synchronize(g, owner, number, registry, dry_run):
    owners = {m["issue"]: m["agent"] for m in json.loads(registry.read_text())["missions"]}
    unknown = sorted({name for name in owners.values()
                      if name.casefold() not in {opt.casefold() for opt in OPTIONS["Agent"]}})
    if unknown:
        raise RuntimeError("Agent registry contains unknown Project options: " + ", ".join(unknown))
    prs = {p["number"]: p for p in g.paged("/repos/" + REPO + "/pulls?state=all")}
    issues = list(g.paged("/repos/" + REPO + "/issues?state=all"))
    content = {("pr" if i.get("pull_request") else "issue", i["number"]): i
               for i in issues}
    for n, pr in prs.items():
        content[("pr", n)] = dict(content.get(("pr", n), {}), **pr, pull_request=True)
    linked = {}
    for pr in prs.values():
        ref = owner_issue(pr.get("body"))
        if pr.get("state") == "open" and ref is not None:
            linked.setdefault(ref, []).append(pr["number"])
    now = datetime.now(timezone.utc)
    project_id, fields = get_project(g, owner, number)
    if not dry_run:
        create_fields(g, project_id, fields)
        project_id, fields = get_project(g, owner, number)
    project_rows = read_items(g, owner, number)
    print("DAO Project #%d: %d existing cards; %d repository issues/PRs" %
          (number, len(project_rows), len(content)), flush=True)
    changes = {"added": 0, "status": 0, "agent": 0, "priority": 0,
               "domain": 0, "evidence": 0}
    for (kind, n), item in sorted(content.items(), key=lambda entry: entry[0][1]):
        row = project_rows.get((kind, n))
        if not row:
            if dry_run:
                row = {"id": "DRY_RUN"}
            else:
                node = item.get("node_id")
                if not node:
                    raise RuntimeError("Issue/PR #%d lacks GraphQL node_id" % n)
                new_id = g.graphql(ADD, p=project_id, c=node)["addProjectV2ItemById"]["item"]["id"]
                row = {"id": new_id}
            changes["added"] += 1
        ref = owner_issue(item.get("body")) if kind == "pr" else n
        values = (
            ("Status", status(item, kind == "issue" and n in linked, now), "status"),
            ("Agent", owners.get(ref, "Non attribué"), "agent"),
            ("Priorité", priority(item), "priority"),
            ("Domaine", domain(item), "domain"),
            ("État GitHub", evidence(item, kind == "issue" and n in linked,
                                     min(linked[n]) if kind == "issue" and n in linked else None, now), "evidence"),
        )
        for field, value, metric in values:
            if set_field(g, project_id, row, fields, field, value, dry_run):
                changes[metric] += 1
    print("DAO_PROJECTS_SYNC " + json.dumps({"dry_run": dry_run, **changes}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--owner", default="Khaey")
    parser.add_argument("--project", type=int, default=3)
    parser.add_argument("--registry", type=Path, default=Path(__file__).resolve().parents[1] /
                        ".github/dao-monitor-agents.json")
    args = parser.parse_args()
    token = os.getenv("DAO_PROJECTS_TOKEN", "")
    if not token:
        print("DAO_PROJECTS_TOKEN secret missing: synchronization NOT executed.")
        return 0
    try:
        synchronize(Github(token), args.owner, args.project, args.registry, args.dry_run)
    except Exception as exc:
        print("DAO_PROJECTS_SYNC_FAILED " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
