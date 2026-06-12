set -euo pipefail
REPO=/home/user/workspace/tgp/audit-roman-p1-r2-ux
cd "$REPO"
{
  echo '=== HEAD ==='; git rev-parse HEAD
  echo '=== BRANCH ==='; git branch --show-current
  echo '=== CHANGED FILES origin/main..HEAD ==='; git diff --name-only origin/main..HEAD || true
  echo '=== ROMAN FILES ==='; find src -path '*roman*' -o -path '*Roman*' | sort
  echo '=== romanVoice.ts ==='; nl -ba src/components/roman/romanVoice.ts
  echo '=== RomanGreeting.tsx ==='; nl -ba src/components/roman/RomanGreeting.tsx
  echo '=== RomanChatScreen.tsx ==='; nl -ba src/screens/roman/RomanChatScreen.tsx
  echo '=== useRomanChat.ts ==='; nl -ba src/screens/roman/useRomanChat.ts
  echo '=== RomanMessageBubble.tsx ==='; nl -ba src/components/roman/RomanMessageBubble.tsx
  echo '=== RomanComposer.tsx ==='; nl -ba src/components/roman/RomanComposer.tsx
  echo '=== RomanState.tsx ==='; nl -ba src/components/roman/RomanState.tsx
  echo '=== RomanAvatar.tsx ==='; nl -ba src/components/roman/RomanAvatar.tsx
  echo '=== community RomanAvatar if exists ==='; if [ -f src/components/community/RomanAvatar.tsx ]; then nl -ba src/components/community/RomanAvatar.tsx; else echo 'no community RomanAvatar'; fi
  echo '=== client MoreScreen roman excerpts ==='; rg -n -C 5 'Roman|romanChat|Open a conversation|concierge' src/screens/client/MoreScreen.tsx
  echo '=== coach SettingsScreen roman excerpts ==='; rg -n -C 6 'Roman|romanChat|Ask for a brief|Concierge|conversation' src/screens/coach/SettingsScreen.tsx
  echo '=== CoachHome/Inbox roman search ==='; rg -n -C 4 'Roman|romanChat|brief|client read|next step|Concierge|RomanAvatar' src/screens/coach src/components/coach src/navigation || true
  echo '=== All romanVoice usage ==='; rg -n 'romanGreeting|ROMAN_|romanVoice|RomanGreeting|RomanState|RomanMessageBubble|RomanTypingIndicator|RomanAvatar' src | sort
  echo '=== Raw hex in src excluding tokens ==='; rg -n '#[0-9A-Fa-f]{3,8}' src --glob '!src/theme/tokens.ts' || true
  echo '=== fontWeight >= 700 ==='; rg -n "fontWeight:\s*['\"]?(700|800|900|bold)['\"]?" src || true
  echo '=== Pressable/TouchableOpacity in changed files ==='; for f in $(git diff --name-only origin/main..HEAD | grep -E '\.(tsx|ts)$' || true); do rg -n -C 3 'Pressable|TouchableOpacity|accessibilityRole|accessibilityLabel|minHeight|minWidth|height:\s*4[8-9]|width:\s*4[8-9]' "$f" || true; done
  echo '=== Animation/reduced motion in changed files ==='; for f in $(git diff --name-only origin/main..HEAD | grep -E '\.(tsx|ts)$' || true); do rg -n -C 3 'Animated|withTiming|LayoutAnimation|AccessibilityInfo\.isReduceMotionEnabled|useReducedMotion|reduceMotion|animation|Easing' "$f" || true; done
  echo '=== Forbidden copy terms in src ==='; rg -n -i "I'm sorry|I’m sorry|Oops|Don't worry|Don’t worry|No problem|amazing|incredible|awesome|Let me help you|I'd be happy to|I’d be happy to|your AI butler|crushing it|let's go|lets go|beast mode|no pain no gain|\bgrind\b|let's get it|slay|no cap|rizz|lowkey|vibe|it's giving|you guys|ship it|north star|low-hanging fruit|MVP|v1|synergy|leverage|circle back|touch base|bandwidth|deliverable|action item|let's align" src || true
  echo '=== Exclamation in Roman files ==='; rg -n '!' src/components/roman src/screens/roman src/screens/client/MoreScreen.tsx src/screens/coach/SettingsScreen.tsx || true
  echo '=== Emoji-ish non-ascii in changed added lines ==='; git diff origin/main..HEAD -- '*.ts' '*.tsx' | grep '^+' | LC_ALL=C grep -n '[^ -~]' || true
  echo '=== Added raw hex ==='; git diff origin/main..HEAD -- '*.ts' '*.tsx' | grep '^+' | grep -E '#[0-9A-Fa-f]{3,8}' || true
  echo '=== Added fontWeight 700+ ==='; git diff origin/main..HEAD -- '*.ts' '*.tsx' | grep '^+' | grep -E "fontWeight:\s*['\"]?(700|800|900|bold)['\"]?" || true
} > /home/user/workspace/roman_p1_r2_audit_evidence.txt
