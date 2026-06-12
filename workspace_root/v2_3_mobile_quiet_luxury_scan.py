import re, sys
cur=None; new_line=None
for l in sys.stdin:
    l=l.rstrip('\n')
    if l.startswith('+++ b/'):
        cur=l[6:]
    elif l.startswith('@@'):
        m=re.search(r'\+(\d+)', l); new_line=int(m.group(1)) if m else None
    elif l.startswith('+') and not l.startswith('+++'):
        content=l[1:]
        flags=[]
        if re.search(r'#[0-9A-Fa-f]{3,8}\b', content) and cur != 'src/theme/tokens.ts': flags.append('raw_hex')
        if re.search(r"fontWeight\s*:\s*[\"']?[7-9]00", content): flags.append('fontWeight_gt_600')
        if re.search(r"Coming soon|We.?re working on it|Oops|Sorry|sonnet", content, re.I): flags.append('copy_banned')
        if re.search(r'[😀-🙏🌀-🗿🚀-🛿☀-⛿✀-➿]', content): flags.append('emoji')
        if re.search(r'\bColors\.[A-Za-z]', content): flags.append('Colors_specific')
        if flags:
            print(f"{cur}:{new_line}: {','.join(flags)}: {content[:240]}")
        if new_line is not None: new_line += 1
    elif not l.startswith('-') and new_line is not None:
        new_line += 1
