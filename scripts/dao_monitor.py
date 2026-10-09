#!/usr/bin/env python3
"""D.A.O Monitor: trusted GitHub events -> outbound Telegram; no VPS needed."""
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / ".github" / "dao-monitor-agents.json"
PREFIX = "DAO_MONITOR_V1"
SILENCE = "DAO_MONITOR_SILENCE_V1"
STATES = {"ACTIVE", "BLOCKED", "WAITING_HUMAN", "PAUSED_QUOTA",
          "HANDOFF", "DONE", "DECISION"}
ALERT_STATES = STATES - {"ACTIVE"}
SYMBOLS = {"BLOCKED": "⛔", "WAITING_HUMAN": "🙋", "PAUSED_QUOTA": "⏸",
           "HANDOFF": "🔁", "DONE": "✅", "DECISION": "🧭"}
REPO = "Khaey/Dao"
BASE = f"https://github.com/{REPO}"


def configuration():
    with CONFIG.open(encoding="utf-8") as handle:
        return json.load(handle)


def clean(value, maxlen=150):
    return re.sub(r"[\x00-\x1f\x7f]+", " ", str(value)).strip()[:maxlen]


def checkpoint(body):
    """Only explicit marker + fixed fields count; historic prose is not a heartbeat."""
    lines = (body or "").strip().splitlines()
    if not lines or lines[0].strip() != PREFIX or len(lines) > 8:
        return None
    fields = {}
    for line in lines[1:]:
        match = re.fullmatch(r"(agent|status|summary):[ \t]*(.*)", line)
        if not match or match.group(1) in fields:
            return None
        fields[match.group(1)] = match.group(2).strip()
    if set(fields) != {"agent", "status", "summary"}:
        return None
    if fields["status"] not in STATES or not fields["agent"]:
        return None
    fields["summary"] = clean(fields["summary"])
    return fields


def mission_for(issue, config):
    return next((x for x in config["missions"] if x["issue"] == issue), None)


def permitted_comment(comment, config):
    return (comment.get("user", {}).get("login") in
            config.get("allowed_comment_authors", []))


def validate_url(url):
    if isinstance(url, str) and (url.startswith(BASE + "/issues/") or
                                  url.startswith(BASE + "/pull/") or
                                  url.startswith(BASE + "/actions/runs/")):
        return url
    return BASE


def _unique_mission(numbers, config):
    """Resolve an issue owner only when exactly one registered mission matches."""
    issues = {int(raw) for raw in numbers if mission_for(int(raw), config)}
    if len(issues) != 1:
        return None, None
    issue = issues.pop()
    return mission_for(issue, config), issue


def pr_owner(pr, config):
    """Derive an agent from a canonical issue, never from the merge actor."""
    title = pr.get("title") or ""
    body = pr.get("body") or ""
    explicit = " ".join(re.findall(
        r"(?i)\b(?:refs?|fixes|closes|resolves|owner\s+issue)\s*:?\s*#\d+\b", body))
    for scope in (title, explicit, title + "\n" + body):
        refs = re.findall(r"(?<!\w)#(\d+)\b", scope)
        mission, issue = _unique_mission(refs, config)
        if mission:
            return mission["agent"], issue
        if refs and scope != title + "\n" + body:
            # An ambiguous explicit reference is not safe to attribute.
            return None, None
    return None, None


def owner_line(pr, config):
    agent, issue = pr_owner(pr or {}, config)
    return (f"👤 Agent : {agent} — mission #{issue}" if agent
            else "👤 Agent : non identifié")


def associated_merged_pr(pulls, sha):
    """Never correlate a CI to a PR without its exact merge SHA."""
    if not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{40}", sha):
        return None
    matches = [pr for pr in pulls if isinstance(pr, dict)
               and pr.get("merge_commit_sha") == sha and pr.get("merged_at")
               and pr.get("base", {}).get("ref") == "main"]
    return matches[0] if len(matches) == 1 else None


def classify(event_name, event, config, related_pr=None):
    if event_name == "issue_comment":
        if event.get("action") != "created" or event.get("issue", {}).get("pull_request"):
            return None
        issue = event.get("issue", {}).get("number")
        mission = mission_for(issue, config)
        comment = event.get("comment", {})
        cp = checkpoint(comment.get("body"))
        if not (mission and cp and permitted_comment(comment, config)):
            return None
        if cp["agent"] != mission["agent"] or cp["status"] not in ALERT_STATES:
            return None
        link = validate_url(comment.get("html_url"))
        return (f"{SYMBOLS[cp['status']]} {mission['agent']} — #{issue}\n"
                f"État : {cp['status']}\n{cp['summary']}\n{link}")
    if event_name == "pull_request":
        pr = event.get("pull_request", {})
        if event.get("action") != "closed" or not pr.get("merged"):
            return None
        if pr.get("base", {}).get("ref") != "main":
            return None
        number = pr.get("number")
        return (f"🔀 D.A.O — PR #{number} fusionnée\n"
                f"{owner_line(pr, config)}\n"
                f"{clean(pr.get('title', ''), 120)}\n"
                f"{validate_url(pr.get('html_url'))}")
    if event_name == "workflow_run":
        run = event.get("workflow_run", {})
        if event.get("action") != "completed":
            return None
        if (run.get("name") != "DAO CI and DEV deploy" or
                run.get("head_branch") != "main" or run.get("event") != "push"):
            return None
        conclusion = run.get("conclusion")
        if conclusion == "success":
            label = "✅ CI et workflow déploiement DEV réussis"
        elif conclusion in {"failure", "timed_out", "cancelled"}:
            label = "❌ CI / déploiement DEV : " + clean(conclusion, 20)
        else:
            return None
        return (f"{label}\n{owner_line(related_pr, config)}\n"
                f"Run #{run.get('run_number')}\n{validate_url(run.get('html_url'))}")
    return None


def telegram(text):
    token = os.environ.get("DAO_MONITOR_TELEGRAM_BOT_TOKEN", "")
    chat = os.environ.get("DAO_MONITOR_TELEGRAM_CHAT_ID", "")
    if not token or not chat:
        print("DAO Monitor: Telegram secrets missing; delivery not activated.")
        return False
    data = urllib.parse.urlencode({"chat_id": chat, "text": text,
                                   "disable_web_page_preview": "true"}).encode()
    req = urllib.request.Request(
        "https://api.telegram.org/bot" + token + "/sendMessage",
        data=data, headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as reply:
            response = json.load(reply)
            if not response.get("ok"):
                raise ValueError("Not OK")
    except Exception:
        raise RuntimeError("Telegram delivery failed; details withheld") from None
    print("DAO Monitor: Telegram message delivered (no recipient details).")
    return True


def github_api(method, endpoint, body=None):
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        raise RuntimeError("Missing GitHub token")
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/{endpoint}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + token,
                 "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28",
                 "Content-Type": "application/json"},
        method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.load(response)
    except Exception:
        raise RuntimeError("GitHub monitoring request failed; details withheld") from None


def issue_comments(issue):
    comments = []
    for page in range(1, 11):
        batch = github_api("GET", f"issues/{issue}/comments?per_page=100&page={page}")
        comments.extend(batch)
        if len(batch) < 100:
            return comments
    # A capped history cannot safely be treated as a complete activity history.
    return []


def silence_candidate(comments, mission, allowed, now, threshold_minutes=90):
    """Return last ACTIVE checkpoint unless later pause/end or prior alert."""
    latest = None
    for item in comments:
        if item.get("user", {}).get("login") not in allowed:
            continue
        cp = checkpoint(item.get("body"))
        if cp and cp["agent"] == mission["agent"]:
            latest = (item, cp)
    if not latest or latest[1]["status"] != "ACTIVE":
        return None
    item = latest[0]
    try:
        last = dt.datetime.fromisoformat(item["created_at"].replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return None
    if now - last < dt.timedelta(minutes=threshold_minutes):
        return None
    marker = f"{SILENCE}:{item['id']}"
    if any(marker in (c.get("body") or "") for c in comments):
        return None
    return marker, last


def watchdog(config):
    """Polling is only for explicit ACTIVE missions, never assigned/paused Pilots."""
    if not os.environ.get("DAO_MONITOR_TELEGRAM_BOT_TOKEN") or not os.environ.get(
            "DAO_MONITOR_TELEGRAM_CHAT_ID"):
        print("DAO Monitor: unconfigured; watchdog inactive.")
        return
    now = dt.datetime.now(dt.timezone.utc)
    for mission in config["missions"]:
        if not mission.get("watchdog", False):
            continue
        issue = mission["issue"]
        comments = issue_comments(issue)
        candidate = silence_candidate(
            comments, mission, config["allowed_comment_authors"], now,
            int(mission.get("threshold_minutes", 90)))
        if not candidate:
            continue
        marker, last = candidate
        link = f"{BASE}/issues/{issue}"
        minutes = int((now - last).total_seconds() // 60)
        message = (f"⚠️ {mission['agent']} — #{issue}\n"
                   f"Activité non confirmée depuis {minutes} min. "
                   f"Un arrêt de Work n'est pas prouvé.\n{link}")
        if telegram(message):
            # Persist idempotency as a machine comment; GITHUB_TOKEN-created
            # comments normally do not trigger another issue_comment workflow.
            github_api("POST", f"issues/{issue}/comments",
                       {"body": f"{marker}\nAlerte de silence DAO Monitor émise. "
                                "Ne constitue pas un diagnostic de crash."})


def main():
    config = configuration()
    event_name = os.environ.get("GITHUB_EVENT_NAME", "")
    if event_name == "schedule":
        watchdog(config)
        return
    if event_name == "workflow_dispatch":
        if os.environ.get("GITHUB_REF") != "refs/heads/main":
            raise SystemExit("Test messages require main.")
        if not telegram("✅ DAO Monitor — @DAOAlertsbot\n"
                        "Test de réception GitHub Actions → Telegram."):
            raise SystemExit("Configure the two Telegram GitHub secrets.")
        return
    if int(os.environ.get("GITHUB_RUN_ATTEMPT", "1")) > 1:
        print("Duplicate rerun skipped.")
        return
    with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as handle:
        event = json.load(handle)
    related_pr = None
    if event_name == "workflow_run":
        run = event.get("workflow_run", {})
        sha = run.get("head_sha")
        if (event.get("action") == "completed"
                and run.get("name") == "DAO CI and DEV deploy"
                and run.get("head_branch") == "main"
                and run.get("event") == "push"
                and isinstance(sha, str)
                and re.fullmatch(r"[a-f0-9]{40}", sha)):
            try:
                pulls = github_api("GET", f"commits/{sha}/pulls?per_page=100")
                related_pr = associated_merged_pr(pulls, sha)
            except RuntimeError:
                # Never drop an alert solely because issue attribution failed.
                print("DAO Monitor: owner lookup unavailable; using unknown agent.")
    message = classify(event_name, event, config, related_pr)
    if message:
        telegram(message)
    else:
        print("No qualified event to notify.")


if __name__ == "__main__":
    main()
