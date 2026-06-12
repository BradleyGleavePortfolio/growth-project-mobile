set -euo pipefail
REPO=/home/user/workspace/tgp/audit-roman-p1-r2-ux
cd "$REPO"
{
  echo '=== community RomanAvatar.tsx ==='; nl -ba src/components/community/RomanAvatar.tsx
  echo '=== RomanTypingIndicator.tsx ==='; nl -ba src/components/roman/RomanTypingIndicator.tsx
  echo '=== client MoreScreen roman excerpts ==='; rg -n -C 8 'Roman|romanChat|Open a conversation|concierge|Concierge|SettingsRow|renderSettingsRow|icon' src/screens/client/MoreScreen.tsx || true
  echo '=== coach SettingsScreen roman excerpts ==='; rg -n -C 10 'Roman|romanChat|Ask for a brief|Concierge|conversation|SettingsRow|renderSettingsRow|icon' src/screens/coach/SettingsScreen.tsx || true
  echo '=== Coach screens Roman search ==='; rg -n -C 4 'Roman|romanChat|brief|client read|next step|Concierge|RomanAvatar' src/screens/coach src/components/coach src/components/community/coach src/navigation || true
  echo '=== All romanVoice usage ==='; rg -n 'romanGreeting|ROMAN_|romanVoice|RomanGreeting|RomanState|RomanMessageBubble|RomanTypingIndicator|RomanAvatar' src | sort
  echo '=== Raw hex in src excluding tokens ==='; rg -n '#[0-9A-Fa-f]{3,8}' src --glob '!src/theme/tokens.ts' || true
  echo '=== fontWeight >= 700 ==='; rg -n "fontWeight:\s*['\"]?(700|800|900|bold)['\"]?" src || true
  echo '=== Pressable/TouchableOpacity in changed files ==='; for f in $(git diff --name-only origin/main..HEAD | grep -E '\.(tsx|ts)$' || true); do echo "--- $f"; rg -n -C 3 'Pressable|TouchableOpacity|accessibilityRole|accessibilityLabel|minHeight|minWidth|height:\s*4[8-9]|width:\s*4[8-9]' "$f" || true; done
  echo '=== Animation/reduced motion in changed files ==='; for f in $(git diff --name-only origin/main..HEAD | grep -E '\.(tsx|ts)$' || true); do echo "--- $f"; rg -n -C 3 'Animated|withTiming|LayoutAnimation|AccessibilityInfo\.isReduceMotionEnabled|useReducedMotion|reduceMotion|animation|Easing' "$f" || true; done
  echo '=== Forbidden copy terms in src ==='; rg -n -i "I'm sorry|I’m sorry|Oops|Don't worry|Don’t worry|No problem|amazing|incredible|awesome|Let me help you|I'd be happy to|I’d be happy to|your AI butler|crushing it|let's go|lets go|beast mode|no pain no gain|\bgrind\b|let's get it|slay|no cap|rizz|lowkey|vibe|it's giving|you guys|ship it|north star|low-hanging fruit|MVP|v1|synergy|leverage|circle back|touch base|bandwidth|deliverable|action item|let's align" src || true
  echo '=== Exclamation in Roman files ==='; rg -n '!' src/components/roman src/screens/roman src/screens/client/MoreScreen.tsx src/screens/coach/SettingsScreen.tsx || true
  echo '=== Emoji-ish non-ascii in changed added lines ==='; git diff origin/main..HEAD -- '*.ts' '*.tsx' | grep '^+' | LC_ALL=C grep -n '[^ -~]' || true
  echo '=== Added raw hex ==='; git diff origin/main..HEAD -- '*.ts' '*.tsx' | grep '^+' | grep -E '#[0-9A-Fa-f]{3,8}' || true
  echo '=== Added fontWeight 700+ ==='; git diff origin/main..HEAD -- '*.ts' '*.tsx' | grep '^+' | grep -E "fontWeight:\s*['\"]?(700|800|900|bold)['\"]?" || true
  echo '=== Added emoji/pictograph rough ==='; git diff origin/main..HEAD -- '*.ts' '*.tsx' | grep '^+' | python3 - <<'PY'
import sys, unicodedata
for i,line in enumerate(sys.stdin,1):
    for ch in line:
        if ord(ch)>0x1F000 or unicodedata.category(ch)=='So':
            print(i, line.rstrip())
            break
PY
} > /home/user/workspace/roman_p1_r2_audit_evidence_rest.txt
