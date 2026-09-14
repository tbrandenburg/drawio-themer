.PHONY: install format format-check lint build test ci run install-global publish release release-patch release-minor release-major clean

# node_modules is a real prerequisite (make treats it as a file/dir
# target), so `install` only re-runs `npm install` when package.json or
# the lockfile actually changed.
install: node_modules

node_modules: package.json package-lock.json
	npm install
	@touch node_modules

# format -> lint -> test -> run -> release: each target depends on the
# previous gate passing first, so `make test` (for example) always
# re-verifies formatting and linting before running the test suite.
format: install
	npm run format

format-check: install
	npm run format:check

lint: format-check
	npm run lint

build: install
	npm run build

test: lint build
	npm run test

# CI gate used by local and GitHub Actions release checks.
ci: test

run: test
	node dist/cli.js --version

# Installs the built CLI globally (npm link-equivalent via the package's
# own "bin" entry), so `drawio-themer` is available on PATH afterward -
# depends on `build` (not `test`/`run`) so it doesn't require a version
# bump or re-running the full gate just to install locally.
install-global: build
	npm install -g .

# Manual/local npm publish. Automated releases use the GitHub Actions
# publish workflow with npm trusted publishing.
publish:
	npm publish

# release-{patch,minor,major}: full format/lint/test/build/run gate
# must pass before `npm version` bumps package.json, commits, and tags,
# then the commit + tag are pushed and a GitHub Release is created from
# the tag (requires `gh` authenticated) so every release bump has a
# corresponding release page, not just a git tag.
release-patch: run
	npm version patch
	git push --follow-tags
	gh release create "v$$(node -p "require('./package.json').version")" --generate-notes

release-minor: run
	npm version minor
	git push --follow-tags
	gh release create "v$$(node -p "require('./package.json').version")" --generate-notes

release-major: run
	npm version major
	git push --follow-tags
	gh release create "v$$(node -p "require('./package.json').version")" --generate-notes

# Default release bump. Override with `make release-patch/-minor/-major`.
release: release-patch

clean:
	rm -rf dist
