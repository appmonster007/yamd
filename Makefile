# Build and install the YAMD VS Code extension.
#
# Quick start:
#   make install     # build the .vsix and install it into VS Code
#
# Run `make help` for the full list of targets.

EXT_DIR  := vscode-yamd
VSIX     := $(shell node -p "require('./$(EXT_DIR)/package.json').name + '-' + require('./$(EXT_DIR)/package.json').version + '.vsix'")
CODE     := $(shell command -v code 2>/dev/null || command -v code-insiders 2>/dev/null)

.PHONY: help deps build typecheck test package package-fast install install-fast uninstall clean dev

help:
	@echo "YAMD — available targets:"
	@echo "  make deps          install npm dependencies"
	@echo "  make build         compile the extension into $(EXT_DIR)/dist/"
	@echo "  make typecheck     run the TypeScript compiler with no output"
	@echo "  make test          run the test suite"
	@echo "  make package       typecheck, test, and build $(EXT_DIR)/$(VSIX)"
	@echo "  make package-fast  typecheck and build $(EXT_DIR)/$(VSIX), skipping tests"
	@echo "  make install       package (with tests) and install into VS Code"
	@echo "  make install-fast  package-fast (no tests) and install into VS Code"
	@echo "  make uninstall     remove the extension from VS Code"
	@echo "  make dev           open $(EXT_DIR)/ in VS Code for F5 debugging"
	@echo "  make clean         remove build output and node_modules"

deps:
	cd $(EXT_DIR) && npm install

build: deps
	cd $(EXT_DIR) && npm run build

typecheck: deps
	cd $(EXT_DIR) && npm run typecheck

test: deps
	cd $(EXT_DIR) && npm test

package: deps
	cd $(EXT_DIR) && npm run package

# Skips the test suite (including a wall-clock perf benchmark that can fail
# under system load on some machines without indicating a real regression).
package-fast: deps
	cd $(EXT_DIR) && npm run typecheck && npm run build && npx vsce package --no-dependencies --skip-license

install: package
	@if [ -z "$(CODE)" ]; then \
		echo "error: the 'code' (or 'code-insiders') CLI was not found on PATH."; \
		echo "In VS Code, run \"Shell Command: Install 'code' command in PATH\" from the Command Palette, then re-run 'make install'."; \
		echo "Or install the .vsix by hand: Extensions view -> ... -> Install from VSIX... -> $(EXT_DIR)/$(VSIX)"; \
		exit 1; \
	fi
	$(CODE) --install-extension $(EXT_DIR)/$(VSIX)
	@echo "Installed $(VSIX). Reload or restart VS Code to activate it."

install-fast: package-fast
	@if [ -z "$(CODE)" ]; then \
		echo "error: the 'code' (or 'code-insiders') CLI was not found on PATH."; \
		echo "In VS Code, run \"Shell Command: Install 'code' command in PATH\" from the Command Palette, then re-run 'make install-fast'."; \
		echo "Or install the .vsix by hand: Extensions view -> ... -> Install from VSIX... -> $(EXT_DIR)/$(VSIX)"; \
		exit 1; \
	fi
	$(CODE) --install-extension $(EXT_DIR)/$(VSIX)
	@echo "Installed $(VSIX). Reload or restart VS Code to activate it."

uninstall:
	@if [ -z "$(CODE)" ]; then \
		echo "error: the 'code' (or 'code-insiders') CLI was not found on PATH."; \
		exit 1; \
	fi
	$(CODE) --uninstall-extension appmonster007.vscode-yamd-ext

dev:
	@if [ -z "$(CODE)" ]; then \
		echo "error: the 'code' (or 'code-insiders') CLI was not found on PATH."; \
		exit 1; \
	fi
	$(CODE) $(EXT_DIR)
	@echo "Press F5 in VS Code to launch the Extension Development Host."

clean:
	rm -rf $(EXT_DIR)/dist $(EXT_DIR)/node_modules $(EXT_DIR)/*.vsix
