import argparse
import sys
import os
import time
from pathlib import Path

# Platform-appropriate file locking
if os.name == 'nt':
    import msvcrt
    def acquire_lock(file_obj):
        # Non-blocking lock attempt
        msvcrt.locking(file_obj.fileno(), msvcrt.LK_NBLCK, 1)

    def release_lock(file_obj):
        try:
            file_obj.seek(0)
            msvcrt.locking(file_obj.fileno(), msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
else:
    import fcntl
    def acquire_lock(file_obj):
        fcntl.flock(file_obj.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

    def release_lock(file_obj):
        try:
            fcntl.flock(file_obj.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass

class FileLock:
    def __init__(self, lock_path, timeout=10.0, retry_delay=0.1):
        self.lock_path = Path(lock_path)
        self.timeout = timeout
        self.retry_delay = retry_delay
        self.lock_file = None

    def __enter__(self):
        start_time = time.time()
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        while True:
            try:
                self.lock_file = open(self.lock_path, "a+")
                acquire_lock(self.lock_file)
                return self
            except (BlockingIOError, PermissionError, OSError):
                if self.lock_file:
                    try:
                        self.lock_file.close()
                    except Exception:
                        pass
                    self.lock_file = None
                if time.time() - start_time >= self.timeout:
                    raise TimeoutError(f"Could not acquire lock on {self.lock_path} within {self.timeout}s")
                time.sleep(self.retry_delay)

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.lock_file:
            try:
                release_lock(self.lock_file)
            finally:
                try:
                    self.lock_file.close()
                except Exception:
                    pass
                self.lock_file = None

def parse_entries(text):
    """
    Parses entries from Edit-Log.md.
    Each entry is formatted as:
    ### [YYYY-MM-DD] <Quest-ID>
    - Files: <files>
    - Summary: <summary>
    - Validation: <validation>
    """
    entries = []
    current_entry = None

    for line in text.splitlines():
        if line.startswith("### "):
            if current_entry:
                entries.append(current_entry)
            # Extract quest id
            header = line.strip()
            quest_id = ""
            parts = header.replace("### ", "").split()
            if len(parts) >= 2:
                quest_id = parts[1]
            elif len(parts) == 1:
                quest_id = parts[0]
            current_entry = {
                "header": header,
                "quest_id": quest_id,
                "lines": []
            }
        elif current_entry is not None:
            if line.strip():
                current_entry["lines"].append(line.rstrip())

    if current_entry:
        entries.append(current_entry)

    return entries

def format_entry(entry):
    lines = [entry["header"]] + entry["lines"]
    return "\n".join(lines)

def main():
    parser = argparse.ArgumentParser(description="Log edit changes into Edit-Log.md safely.")
    parser.add_argument("--quest", required=True, help="Quest ID (e.g., Q-20261012-ai-system-setup)")
    parser.add_argument("--files", required=True, help="Comma-separated or list of modified file paths")
    parser.add_argument("--summary", required=True, help="Summary of changes and rationale")
    parser.add_argument("--validation", required=True, help="Validation results and limitations")
    args = parser.parse_args()

    # Determine paths
    repo_root = Path(__file__).resolve().parent.parent.parent
    context_dir = repo_root / "Context"
    edit_log_file = context_dir / "Edit-Log.md"
    archive_dir = context_dir / "archive" / "edit-log"
    lock_file = context_dir / ".edit-log.lock"

    archive_dir.mkdir(parents=True, exist_ok=True)

    today_str = time.strftime("%Y-%m-%d")
    header_line = f"### [{today_str}] {args.quest.strip()}"
    new_entry = {
        "header": header_line,
        "quest_id": args.quest.strip(),
        "lines": [
            f"- Files: {args.files.strip()}",
            f"- Summary: {args.summary.strip()}",
            f"- Validation: {args.validation.strip()}"
        ]
    }

    with FileLock(lock_file):
        existing_content = ""
        preamble = "# Edit Log\n\nRecent edit revisions (max 10 entries retained):\n\n"
        if edit_log_file.exists():
            existing_content = edit_log_file.read_text(encoding="utf-8")

        entries = parse_entries(existing_content)

        # Update if duplicate Quest ID exists, or prepend new entry
        found_idx = -1
        for idx, item in enumerate(entries):
            if item.get("quest_id") == new_entry["quest_id"]:
                found_idx = idx
                break

        if found_idx != -1:
            entries[found_idx] = new_entry
        else:
            entries.insert(0, new_entry)

        # If more than 10 entries, archive older entries
        retained = entries[:10]
        archived = entries[10:]

        if archived:
            archive_date = time.strftime("%Y%m")
            archive_file = archive_dir / f"edit-log-{archive_date}.md"
            archive_text = ""
            if archive_file.exists():
                archive_text = archive_file.read_text(encoding="utf-8")
            else:
                archive_text = f"# Edit Log Archive - {archive_date}\n\n"

            archive_blocks = [format_entry(e) for e in archived]
            combined_archive = archive_text.rstrip() + "\n\n" + "\n\n".join(archive_blocks) + "\n"

            # Atomic write to archive
            temp_arch = archive_dir / f".tmp_{archive_file.name}_{os.getpid()}"
            temp_arch.write_text(combined_archive, encoding="utf-8")
            temp_arch.replace(archive_file)

        # Write retained entries back to Edit-Log.md atomically
        log_blocks = [format_entry(e) for e in retained]
        content_to_write = preamble + "\n\n".join(log_blocks) + "\n"

        temp_edit_log = context_dir / f".tmp_edit_log_{os.getpid()}"
        temp_edit_log.write_text(content_to_write, encoding="utf-8")
        temp_edit_log.replace(edit_log_file)

    print(f"Successfully logged quest {args.quest} in {edit_log_file}")

if __name__ == "__main__":
    main()
