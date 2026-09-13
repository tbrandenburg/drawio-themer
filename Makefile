.PHONY: install format format-check lint build test run install-global release release-patch release-minor release-major clean

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

run: test
	node dist/cli.js --version

# Installs the built CLI globally (npm link-equivalent via the package's
# own "bin" entry), so `drawio-themer` is available on PATH afterward -
# depends on `build` (not `test`/`run`) so it doesn't require a version
# bump or re-running the full gate just to install locally.
install-global: build
	npm install -g .

# release-{patch,minor,major}: full format/lint/test/build/run gate
# must pass before `npm version` bumps package.json, commits, and tags,
# then the commit + tag are pushed.
release-patch: run
	npm version patch
	git push --follow-tags

release-minor: run
	npm version minor
	git push --follow-tags

release-major: run
	npm version major
	git push --follow-tags

# Default release bump. Override with `make release-patch/-minor/-major`.
release: release-patch

clean:
	rm -rf dist
