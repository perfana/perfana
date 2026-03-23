.PHONY: setup dev test seed lint type-check clean

setup:
	./scripts/setup.sh

dev:
	npm run dev

test:
	npm run test

seed:
	npx tsx scripts/seed.ts

lint:
	npm run lint

type-check:
	npm run type-check

clean:
	docker compose -f docker-compose.infra.yml down -v
