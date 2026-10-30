"""Publish exactly the five assets recorded by verify_release.py."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

REPOSITORY = "berazin/AILS_desktop"


def gh(*args, capture=False):
    return subprocess.run(["gh", *args], check=True, text=True, encoding="utf-8",
                          stdout=subprocess.PIPE if capture else None).stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--notes", required=True, type=Path)
    parser.add_argument("--finalize-draft", action="store_true",
                        help="Verify an already uploaded draft and publish it without uploading again")
    args = parser.parse_args()
    root = args.output.resolve()
    report = json.loads((root / "release-verification.json").read_text())
    renderer = json.loads((root / "renderer-verification.json").read_text())
    assert renderer["bridge"] and renderer["health"]["ok"]
    assert report["installer"]["ready"] and report["installer"]["old_install_preserved"]
    assert report["backend"]["api_auth"] and report["backend"]["frontend"]
    assets = report["assets"]
    assert len(assets) == 5
    for item in assets:
        file = (root / item["name"]).resolve()
        file.relative_to(root)
        with file.open("rb") as stream:
            assert hashlib.file_digest(stream, "sha256").hexdigest() == item["sha256"], file
        assert file.stat().st_size == item["size"]
    version = report["version"]
    tag = f"v{version}-dev"
    existing = json.loads(gh("api", f"repos/{REPOSITORY}/releases?per_page=100", capture=True))
    matches = [release for release in existing if release["tag_name"] == tag]
    if args.finalize_draft:
        if len(matches) != 1 or not matches[0]["draft"]:
            raise RuntimeError(f"Expected exactly one draft for {tag}")
        release_id = matches[0]["id"]
    elif matches:
        raise RuntimeError(f"Release {tag} already exists; refusing a duplicate or overwrite")
    else:
        # Use the creation response: release listings can lag behind creation.
        created = subprocess.run(
            ["gh", "api", "-X", "POST", f"repos/{REPOSITORY}/releases", "--input", "-"],
            input=json.dumps({"tag_name": tag, "name": f"AILS Developer {version}",
                              "body": args.notes.read_text(encoding="utf-8"),
                              "draft": True, "prerelease": False}),
            check=True, text=True, encoding="utf-8", capture_output=True,
        )
        draft = json.loads(created.stdout)
        assert draft["draft"] and draft["tag_name"] == tag
        release_id = draft["id"]
        (root / "release-draft.json").write_text(
            json.dumps({"id": release_id, "tag": tag, "url": draft["html_url"]}, indent=2),
            encoding="utf-8",
        )
        gh("release", "upload", tag, "--repo", REPOSITORY, *[str(root / item["name"]) for item in assets])
    remote = json.loads(gh("api", f"repos/{REPOSITORY}/releases/{release_id}", capture=True))
    uploaded = {item["name"]: item for item in remote["assets"]}
    assert set(uploaded) == {item["name"] for item in assets}
    for item in assets:
        actual = uploaded[item["name"]]
        assert actual["size"] == item["size"] and actual["state"] == "uploaded", item["name"]
        assert actual.get("digest") == "sha256:" + item["sha256"], item["name"]
    gh("release", "edit", tag, "--repo", REPOSITORY, "--draft=false", "--latest")
    published = json.loads(gh("api", f"repos/{REPOSITORY}/releases/tags/{tag}", capture=True))
    assert not published["draft"] and not published["prerelease"]
    (root / "published-release.json").write_text(json.dumps({
        "url": published["html_url"], "published_at": published["published_at"],
        "assets": assets,
    }, indent=2), encoding="utf-8")
    print(published["html_url"])


if __name__ == "__main__":
    main()
