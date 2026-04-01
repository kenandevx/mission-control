content = open('scripts/install.sh').read()
old_block = 'step "Checking SSH access to GitHub ..."\nif ssh -T git@github.com 2>/dev/null || true | grep -q "successfully"; then\n  info "SSH access to GitHub — OK"\nelse\n  warn "No SSH access to GitHub. Switching to HTTPS clone."\n  GIT_REPO="https://github.com/kenandevx/mission-control.git"\nfi'
new_block = 'step "Using HTTPS clone (SSH not required)"\nGIT_REPO="https://github.com/kenandevx/mission-control.git"'
if old_block in content:
    content = content.replace(old_block, new_block)
    print("replaced OK")
else:
    print("NOT FOUND")
open('scripts/install.sh', 'w').write(content)
