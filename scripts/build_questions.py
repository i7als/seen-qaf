# يحوّل بنك الأسئلة إلى JSON للواجهة والباك إند
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from questions_source import CATEGORIES

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = {"version": 1, "categories": []}
for cid, name, levels in CATEGORIES:
    qs = []
    for level in (200, 400, 600):
        for i, (q, a) in enumerate(levels[level]):
            qs.append({"id": f"{cid}-{level}-{i+1}", "level": level, "q": q, "a": a})
    out["categories"].append({"id": cid, "name": name, "questions": qs})

data = json.dumps(out, ensure_ascii=False, indent=1)
for target in ("backend/questions.json", "frontend/questions.json"):
    path = os.path.join(root, target)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(data)
print("فئات:", len(out["categories"]), "| أسئلة:", sum(len(c["questions"]) for c in out["categories"]))
