#!/usr/bin/env python3
"""Sync DAO Project #3 from repo issues/PRs and canonical agent registry.
Requires DAO_PROJECTS_TOKEN classic PAT scoped project+repo in Actions Secrets.
A merge/closed issue never independently proves DEV deployment.
"""
import argparse
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
              "DAO DEV 20", "DAO OPT 2", "DAO OPT 20", "DAO AUD 1", "DAO Pilot 4",
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
    return "P" + found.group(1) if found else None


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
    return next((g for g, words in groups if any(w in name for w in words)), None)


def status(item, open_linked_pr=False):
    if item.get("pull_request"):
        if item.get("merged_at"):
            return "Done"
        return "In Progress" if item.get("state") == "open" else None
    if item.get("state") == "closed":
        return "Done"
    return "In Progress" if open_linked_pr else None


def evidence(item):
    if item.get("pull_request"):
        if item.get("merged_at"):
            return "PR fusionnée ; déploiement DEV non attesté par le seul merge"
        if item.get("state") == "closed":
            return "PR fermée sans fusion ; non livrée"
        return "PR ouverte ; vérifier la CI et le checkpoint"
    if item.get("state") == "closed":
        if item.get("state_reason") in ("duplicate", "not_planned"):
            return "Issue close (doublon/abandonnée) ; non livrée"
        return "Issue close ; vérifier la preuve du déploiement"
    return "Issue ouverte ; voir dernier checkpoint"


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
   ... on ProjectV2SingleSelectField{id name options{id name}}
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
    return project["id"], fields


def create_fields(g, project_id, fields):
    for field_name, names in OPTIONS.items():
        if field_name not in fields:
            opts = [{"name": n, "description": n, "color": COLORS[i % len(COLORS)]}
                    for i, n in enumerate(names)]
            g.graphql(CREATE, input={"projectId": project_id, "name": field_name,
                                     "dataType": "SINGLE_SELECT", "singleSelectOptions": opts})
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
            return False
        value = {"singleSelectOptionId": option["id"]}
    if not dry_run:
        g.graphql(SET, input={"projectId": project, "itemId": row["id"],
                              "fieldId": fields[key]["id"], "value": value})
    return True


def synchronize(g, owner, number, registry, dry_run):
    owners = {m["issue"]: m["agent"] for m in json.loads(registry.read_text())["missions"]}
    prs = {p["number"]: p for p in g.paged("/repos/" + REPO + "/pulls?state=all")}
    issues = list(g.paged("/repos/" + REPO + "/issues?state=all"))
    content = {("pr" if i.get("pull_request") else "issue", i["number"]): i
               for i in issues}
    for n, pr in prs.items():
        content[("pr", n)] = dict(content.get(("pr", n), {}), **pr, pull_request=True)
    linked = {owner_issue(pr.get("body")) for pr in prs.values()
              if pr.get("state") == "open" and owner_issue(pr.get("body"))}
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
            ("Status", status(item, kind == "issue" and n in linked), "status"),
            ("Agent", owners.get(ref), "agent"),
            ("Priorité", priority(item), "priority"),
            ("Domaine", domain(item), "domain"),
            ("État GitHub", evidence(item), "evidence"),
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
