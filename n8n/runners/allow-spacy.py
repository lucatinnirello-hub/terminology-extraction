# Build step for the Dockerfile: adds spacy to the Python runner's
# N8N_RUNNERS_EXTERNAL_ALLOW in the image's own n8n-task-runners.json, so the
# rest of that file stays exactly as n8n shipped it for this version.
import json
import sys

path = sys.argv[1]
with open(path) as f:
    config = json.load(f)

runners = [r for r in config.get("task-runners", []) if r.get("runner-type") == "python"]
if not runners:
    sys.exit(f"No python runner in {path}; this n8n version's config format differs. Edit it by hand.")

for runner in runners:
    env = runner.setdefault("env-overrides", {})
    allowed = [m.strip() for m in env.get("N8N_RUNNERS_EXTERNAL_ALLOW", "").split(",") if m.strip()]
    if "*" not in allowed and "spacy" not in allowed:
        allowed.append("spacy")
    env["N8N_RUNNERS_EXTERNAL_ALLOW"] = ",".join(allowed)
    print("python runner N8N_RUNNERS_EXTERNAL_ALLOW =", env["N8N_RUNNERS_EXTERNAL_ALLOW"])

with open(path, "w") as f:
    json.dump(config, f, indent=2)
