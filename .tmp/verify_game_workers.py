import json
import threading
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import Error, sync_playwright


ROOT = Path(__file__).resolve().parent.parent


@contextmanager
def local_server(port: int = 4174):
    handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}/src/pages/game/index.html"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def main() -> None:
    result = {
        "miner_stays_at_mountain": False,
        "hauler_clears_visible_rocks": False,
        "stored_ore_after_cycle": 0,
        "ground_ore_after_cycle": 0,
        "rock_count_after_cycle": 0,
    }

    with local_server() as url:
        with sync_playwright() as playwright:
            with TemporaryDirectory() as user_data_dir:
                launch_kwargs = {
                    "user_data_dir": user_data_dir,
                    "headless": True,
                    "viewport": {"width": 1600, "height": 900},
                }

                try:
                    context = playwright.chromium.launch_persistent_context(
                        channel="chromium",
                        **launch_kwargs,
                    )
                except Error:
                    context = playwright.chromium.launch_persistent_context(**launch_kwargs)

                page = context.new_page()
                try:
                    page.goto(url, wait_until="domcontentloaded")
                    page.wait_for_load_state("networkidle")
                    page.locator("#start-game").click()
                    page.wait_for_function(
                        "() => document.body.dataset.gameState === 'playing'",
                        timeout=10000,
                    )

                    result["miner_stays_at_mountain"] = page.evaluate(
                        """async () => {
                            const mountain = document.querySelector('.ore-mountain');
                            const miner = document.querySelector('.game-worker[data-role="miner"]');
                            if (!mountain || !miner) {
                                return false;
                            }

                            const mountainRect = mountain.getBoundingClientRect();
                            const miningX = mountainRect.left + mountainRect.width * 0.6;
                            const deadline = performance.now() + 3400;
                            let previousOre = Number(mountain.dataset.ore || '0');
                            let oreDrops = 0;
                            let maxDeviation = 0;

                            while (performance.now() < deadline) {
                                const minerRect = miner.getBoundingClientRect();
                                const minerX = minerRect.left + minerRect.width / 2;
                                maxDeviation = Math.max(maxDeviation, Math.abs(minerX - miningX));

                                const currentOre = Number(mountain.dataset.ore || '0');
                                if (currentOre < previousOre) {
                                    oreDrops += previousOre - currentOre;
                                }
                                previousOre = currentOre;

                                await new Promise((resolve) => requestAnimationFrame(resolve));
                            }

                            return oreDrops >= 2 && maxDeviation <= 56;
                        }"""
                    )

                    result["hauler_clears_visible_rocks"] = page.evaluate(
                        """async () => {
                            const mountain = document.querySelector('.ore-mountain');
                            const target = mountain?.querySelector(`.ore-mountain__hitbox--${mountain.dataset.stage}`);
                            const stored = document.querySelector('#stored-ore-count');
                            const ground = document.querySelector('#ground-ore-count');
                            if (!mountain || !target || !stored || !ground) {
                                return false;
                            }

                            const rect = target.getBoundingClientRect();
                            for (let index = 0; index < 6; index += 1) {
                                target.dispatchEvent(new MouseEvent('click', {
                                    bubbles: true,
                                    clientX: rect.left + rect.width * 0.58,
                                    clientY: rect.top + rect.height * 0.44,
                                }));
                                await new Promise((resolve) => setTimeout(resolve, 50));
                            }

                            const deadline = performance.now() + 6500;
                            let previousRockCount = document.querySelectorAll('.ore-rock-drop').length;
                            let sawRockCountDrop = false;
                            let sawStoredIncrease = Number(stored.textContent || '0') > 0;

                            while (performance.now() < deadline) {
                                const currentRockCount = document.querySelectorAll('.ore-rock-drop').length;
                                const storedCount = Number(stored.textContent || '0');
                                if (currentRockCount < previousRockCount) {
                                    sawRockCountDrop = true;
                                }
                                if (storedCount > 0) {
                                    sawStoredIncrease = true;
                                }
                                previousRockCount = currentRockCount;
                                await new Promise((resolve) => requestAnimationFrame(resolve));
                            }

                            return sawStoredIncrease && sawRockCountDrop;
                        }"""
                    )

                    result["stored_ore_after_cycle"] = int(page.locator("#stored-ore-count").text_content() or "0")
                    result["ground_ore_after_cycle"] = int(page.locator("#ground-ore-count").text_content() or "0")
                    result["rock_count_after_cycle"] = page.locator(".ore-rock-drop").count()
                finally:
                    context.close()

    print(json.dumps(result, ensure_ascii=False, indent=2))

    assert result["miner_stays_at_mountain"], "expected miner to stay near the mountain while auto-mining"
    assert result["hauler_clears_visible_rocks"], "expected hauler pickups to clear visible rock sprites"


if __name__ == "__main__":
    main()
