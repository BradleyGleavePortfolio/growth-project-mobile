import subprocess, re, json
repo='/home/user/workspace/tgp/audit-mwb-4-237-r5-code'
diff=subprocess.check_output(['git','-C',repo,'diff','--unified=0','main...HEAD'], text=True, errors='replace')
rows=[]
file=None; new_line=None
for line in diff.splitlines():
    if line.startswith('+++ b/'):
        file=line[6:]
    elif line.startswith('@@'):
        m=re.search(r'\+(\d+)(?:,(\d+))?', line)
        new_line=int(m.group(1)) if m else None
    elif line.startswith('+') and not line.startswith('+++'):
        if file and new_line is not None:
            rows.append((file,new_line,line[1:]))
            new_line += 1
    elif line.startswith('-') and not line.startswith('---'):
        pass
    else:
        if new_line is not None:
            new_line += 1
open('/home/user/workspace/pr237_added_lines.tsv','w').write('\n'.join(f'{f}\t{n}\t{text}' for f,n,text in rows))
patterns={
 'swallowed_catch_or_empty_catch': r'catch\s*(?:\([^)]*\))?\s*\{\s*\}?|catch\s*(?:\([^)]*\))?\s*=>\s*\{\s*\}?',
 'eslint_disable': r'eslint-disable|eslint-disable-next-line|eslint-disable-line',
 'ts_ignore_expect': r'@ts-ignore|@ts-expect-error',
 'console': r'\bconsole\.(log|debug|info|warn|error)\b',
 'todo_fixme_hack': r'\b(TODO|FIXME|HACK|XXX)\b',
 'only_skip': r'\b(describe|it|test)\.(only|skip)\b',
 'focused_fit_fdescribe': r'\b(fit|fdescribe)\s*\(',
 'dangerously_set_inner_html': r'dangerouslySetInnerHTML',
 'eval_or_function_ctor': r'\beval\s*\(|new Function\s*\(',
 'hardcoded_secret': r'(api[_-]?key|secret|token|password)\s*[:=]\s*[\'\"][^\'\"]{8,}',
 'any_type': r'\bany\b',
 'non_null_assertion': r'!\.',
 'set_timeout_interval': r'\b(setTimeout|setInterval)\s*\(',
 'async_void_float': r'void\s+\w+\(|\.catch\s*\(\s*\)',
 'alert': r'\balert\s*\(',
 'schema_migration': r'CREATE TABLE|ALTER TABLE|DROP TABLE|ADD COLUMN|supabase/migrations|schema',
}
report=[]
for name,pat in patterns.items():
    cre=re.compile(pat, re.I)
    hits=[(f,n,t) for f,n,t in rows if cre.search(t)]
    report.append((name,hits))
with open('/home/user/workspace/pr237_grep_sweep.txt','w') as out:
    for name,hits in report:
        out.write(f'## {name}: {len(hits)}\n')
        for f,n,t in hits[:200]: out.write(f'{f}:{n}: {t}\n')
        if len(hits)>200: out.write(f'... {len(hits)-200} more\n')
print(f'added_lines={len(rows)}')
for name,hits in report:
    print(f'{name}: {len(hits)}')
