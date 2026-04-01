#!/usr/bin/env python3
import re

# ── Remove uninstall from settings-page-client.tsx ─────────────
with open('components/settings/settings-page-client.tsx', 'r') as f:
    src = f.read()

orig_len = len(src.splitlines())

# Remove state vars
src = re.sub(r'\n  const \[uninstallDialogOpen.*?\n  const \[uninstalling.*?\n', '\n', src)
# Remove runUninstall fn
src = re.sub(r'\n  const runUninstall.*?(?=\n  const |\n  // ──|\n\}\n  useEffect)', '\n', src, flags=re.DOTALL)
# Remove Uninstall button section (label=Uninstall.../Uninstall$)
src = re.sub(r'\n        <CardHeader>.*?Uninstall\s*</Button>\s*</CardFooter>', '\n', src, flags=re.DOTALL)
# Remove Uninstall Dialog
src = re.sub(r'\n      \{/\* ── Uninstall Dialog.*?Confirm Uninstall.*?\n      </AlertDialog>', '\n', src, flags=re.DOTALL)

new_len = len(src.splitlines())
print(f"Settings: {orig_len} → {new_len} lines ({orig_len - new_len} removed)")

with open('components/settings/settings-page-client.tsx', 'w') as f:
    f.write(src)

# ── Remove uninstall action from API route ──────────────────
with open('app/api/system/route.ts', 'r') as f:
    src = f.read()

src = re.sub(r'\n    if \(action === "uninstall"\) \{.*?return fail\(`, Unknown action:', '\n\n    return fail(`Unknown action:', src, flags=re.DOTALL)

with open('app/api/system/route.ts', 'w') as f:
    f.write(src)
print("API route: uninstall action removed")

print("Done.")
