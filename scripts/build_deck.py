import os
import hashlib
import html
from datetime import datetime
import genanki
from git import Repo

DECK_ID = 2059400110
MODEL_ID = 1607392319

# Updated Note Model with basic CSS for context vs additions
NOTE_MODEL = genanki.Model(
    MODEL_ID,
    'GitHub Daily Note',
    fields=[
        {'name': 'Date'},
        {'name': 'Content'},
    ],
    templates=[
        {
            'name': 'Card 1',
            'qfmt': '<h2>{{Date}}</h2>',
            'afmt': '''
            <style>
                .hunk-header { color: #888; font-size: 0.9em; font-style: italic; margin-top: 15px; border-bottom: 1px solid #ccc; }
                .context-line { color: #888; }
                .add-line { color: #2ea043; font-weight: bold; }
                .code-block { background: #f6f8fa; padding: 10px; border-radius: 6px; font-family: monospace; white-space: pre-wrap; }
            </style>
            {{FrontSide}}<hr id="answer">{{Content}}
            ''',
        },
    ]
)

def generate_guid(date_str):
    hash_obj = hashlib.md5(date_str.encode('utf-8'))
    return str(int(hash_obj.hexdigest()[:15], 16))

def build_deck(repo_path='.', output_file='anki-decks/daily-notes.apkg'):
    repo = Repo(repo_path)
    deck = genanki.Deck(DECK_ID, 'GitHub Notes::Daily')
    
    # Format: { 'YYYY-MM-DD': { 'filename.md': [ {'heading': '## Section', 'lines': [('type', 'text')]} ] } }
    daily_changes = {}

    for commit in repo.iter_commits():
        author_datetime = datetime.fromtimestamp(commit.authored_date)
        date_str = author_datetime.strftime('%Y-%m-%d')
        
        if date_str not in daily_changes:
            daily_changes[date_str] = {}
            
        patch_str = repo.git.show(commit.hexsha, '--format=', '--patch')
        
        current_file = None
        current_hunk = None

        for line in patch_str.split('\n'):
            if line.startswith('+++ b/'):
                current_file = line[6:]
                if current_file not in daily_changes[date_str]:
                    daily_changes[date_str][current_file] = []
            
            elif line.startswith('@@ ') and current_file:
                # Extract the nearest heading/context from the git @@ line
                parts = line.split('@@', 2)
                heading = parts[2].strip() if len(parts) == 3 else ""
                current_hunk = {'heading': heading, 'lines': []}
                daily_changes[date_str][current_file].append(current_hunk)
                
            elif current_hunk is not None:
                if line.startswith('+') and not line.startswith('+++'):
                    current_hunk['lines'].append(('add', line[1:]))
                elif line.startswith(' '): # Context lines start with a space
                    current_hunk['lines'].append(('context', line[1:]))
                # We ignore '-' (deletions) to keep cards focused on what was learned/added

    # Build notes for each day
    for date_str, files in sorted(daily_changes.items()):
        content_html = ""
        has_additions = False
        
        for filename, hunks in files.items():
            file_html = f"<h3>{html.escape(filename)}</h3>"
            hunks_html = ""
            
            for hunk in hunks:
                # Only include hunks that actually have additions (ignore pure context/deletions)
                if not any(line_type == 'add' for line_type, _ in hunk['lines']):
                    continue
                    
                has_additions = True
                if hunk['heading']:
                    hunks_html += f"<div class='hunk-header'>Near: {html.escape(hunk['heading'])}</div>"
                else:
                    hunks_html += f"<div class='hunk-header'>Snippet</div>"
                
                hunks_html += "<div class='code-block'>"
                for line_type, text in hunk['lines']:
                    if line_type == 'add':
                        hunks_html += f"<div class='add-line'>+ {html.escape(text)}</div>"
                    elif line_type == 'context':
                        hunks_html += f"<div class='context-line'>  {html.escape(text)}</div>"
                hunks_html += "</div>"
            
            if hunks_html:
                content_html += file_html + hunks_html
            
        if has_additions:
            note = genanki.Note(
                model=NOTE_MODEL,
                fields=[date_str, content_html],
                guid=generate_guid(date_str)
            )
            deck.add_note(note)

    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    genanki.Package(deck).write_to_file(output_file)
    print(f"Successfully generated {output_file}.")

if __name__ == '__main__':
    build_deck()