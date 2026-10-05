.PHONY: test help

help:
	@echo "waha-calendar-reminder commands:"
	@echo "  make test  - Run test suite (146 tests with node:test)"

test:
	TZ=Europe/Rome node --test tests/apps-script/
