/*
 * 操作確認スクリプト（開発用。アプリ本体の依存関係ではありません）
 *
 * 実行方法:
 *   python3 -m http.server 8123 --directory research-guide &
 *   node research-guide/tests/e2e.js            # 既定: http://localhost:8123/index.html
 *
 * Playwright（chromium）が利用できる環境を前提とします。
 */
const { chromium } = require("playwright");
const assert = require("assert");
const path = require("path");
const fs = require("fs");

const BASE = process.env.BASE_URL || "http://localhost:8123/index.html";
const SHOT_DIR = process.env.SHOT_DIR || null;
const origin = new URL(BASE).origin;
const KEY = "research-report-guide";
const LABELS = ["目的", "問い", "情報整理", "根拠確認", "骨子"];

let passed = 0;
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log("ok   - " + name);
  } catch (e) {
    console.log("FAIL - " + name);
    throw e;
  }
}

async function newPage(browser, opts = {}) {
  const context = await browser.newContext(opts.context || {});
  const requests = [];
  context.on("request", (r) => requests.push(r.url()));
  if (opts.init) await context.addInitScript(opts.init);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(BASE);
  return { context, page, requests, errors };
}

async function answerQuiz(page, values) {
  await page.getByRole("button", { name: "始める" }).click();
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const label = await page.locator(".progress__label").textContent();
    seen.push(label);
    await page.locator(`input[value="${values[i]}"]`).check();
    await page.getByRole("button", { name: i === 4 ? "結果を見る" : "次へ →" }).click();
  }
  return seen;
}

async function storedData(page) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), KEY);
}

(async () => {
  const browser = await chromium.launch();

  // --- 1〜2. カード表示とコピー -----------------------------------------
  {
    const { context, page, requests, errors } = await newPage(browser, {
      context: { permissions: ["clipboard-read", "clipboard-write"] },
    });

    await step("トップ見出し・4つの入口・お気に入り・5問のチェック導線", async () => {
      assert.strictEqual(await page.locator("h1").textContent(), "お仕事で、どこに迷っていますか？");
      const entries = await page.locator(".entry__text").allTextContents();
      assert.deepStrictEqual(entries, [
        "調べたいことが、うまくまとまらない",
        "情報が多くて、整理できない",
        "AIの回答が、しっくりこない",
        "報告書の流れが、決まらない",
      ]);
      await page.getByRole("heading", { name: "お気に入り" }).waitFor();
      await page.getByRole("heading", { name: "どこから始めるか迷ったら、5問のチェック" }).waitFor();
    });

    await step("入力欄（ラジオ以外）がない", async () => {
      for (const sel of ["input:not([type=radio])", "textarea", "select", "[contenteditable]"]) {
        assert.strictEqual(await page.locator(sel).count(), 0, sel);
      }
    });

    await step("入口から実用カードを直接表示し、共通構成がそろう", async () => {
      await page.getByRole("button", { name: /報告書の流れが、決まらない/ }).click();
      await page.getByRole("heading", { name: "次のお仕事で試せそうなこと" }).waitFor();
      await page.getByText("見出しごとに「ここで何を伝えるか」を一文添えてみましょう。").waitFor();
      await page.getByRole("heading", { name: "回答を見るポイント" }).waitFor();
      for (const name of ["指示文をコピー", "☆ お気に入りに保存", "試してみた", "別の方法を探す"]) {
        await page.getByRole("button", { name, exact: true }).waitFor();
      }
      await page.getByText("個人情報や社外秘の情報は追記しないでください。", { exact: false }).waitFor();
    });

    await step("コピー対象は指示文本体だけ", async () => {
      const expected = (await page.locator(".prompt__text").textContent()).trim();
      await page.getByRole("button", { name: "指示文をコピー" }).click();
      await page.getByText("指示文をコピーしました。").waitFor();
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      assert.strictEqual(clip, expected);
      assert.ok(clip.startsWith("以下の報告目的とメモから"));
      assert.ok(!clip.includes("回答を見るポイント"));
    });

    await step("URL が変化しない（入力内容を URL に含めない）", async () => {
      assert.strictEqual(page.url(), BASE);
    });

    assert.deepStrictEqual(errors, []);
    await context.close();
  }

  // --- コピー失敗時の手動コピー -------------------------------------------
  {
    const { context, page } = await newPage(browser, {
      init: () => {
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: () => Promise.reject(new Error("denied")) },
        });
        document.execCommand = () => false;
      },
    });
    await step("コピー失敗時はエラー表示と全文選択で手動コピーできる", async () => {
      await page.getByRole("button", { name: /調べたいことが/ }).click();
      await page.getByRole("button", { name: "指示文をコピー" }).click();
      await page.getByText("自動でコピーできませんでした。").waitFor();
      const selected = await page.evaluate(() => window.getSelection().toString());
      const prompt = await page.locator(".prompt__text").textContent();
      assert.strictEqual(selected.trim(), prompt.trim());
    });
    await context.close();
  }

  // --- 4. お気に入り・実践記録・削除 ----------------------------------------
  {
    const { context, page } = await newPage(browser);
    await step("お気に入り保存／解除と schemaVersion", async () => {
      await page.getByRole("button", { name: /情報が多くて/ }).click();
      await page.getByRole("button", { name: "☆ お気に入りに保存" }).click();
      const btn = page.getByRole("button", { name: "★ お気に入りを解除" });
      assert.strictEqual(await btn.getAttribute("aria-pressed"), "true");
      const d = await storedData(page);
      assert.strictEqual(d.schemaVersion, 1);
      assert.deepStrictEqual(d.favorites, ["organize"]);
    });

    await step("試してみた・任意の感想を端末内に保存", async () => {
      await page.getByRole("button", { name: "試してみた", exact: true }).click();
      await page.getByText("試してみて、どうでしたか？（任意）").waitFor();
      let d = await storedData(page);
      assert.deepStrictEqual(d.practice.organize, { tried: true, feedback: null });
      await page.getByLabel("少し合わなかった").check();
      d = await storedData(page);
      assert.strictEqual(d.practice.organize.feedback, "mismatch");
    });

    await step("別の方法を探す → ほかのカードへ", async () => {
      await page.getByRole("button", { name: "別の方法を探す" }).click();
      await page.getByRole("heading", { name: "ほかの方法" }).waitFor();
      assert.strictEqual(await page.locator(".alt .fav-item").count(), 4);
    });

    await step("再読み込み後もお気に入りがトップに表示される", async () => {
      await page.reload();
      await page.getByRole("button", { name: "調査・報告の進め方ガイド" }).click();
      const favs = await page.locator(".fav-list .fav-item").allTextContents();
      assert.strictEqual(favs.length, 1);
      assert.ok(favs[0].includes("情報が多くて、整理できない"));
      assert.ok(favs[0].includes("試してみた"));
    });

    await step("端末内の記録をまとめて削除（確認つき）", async () => {
      await page.getByRole("button", { name: "端末内の記録について・まとめて削除" }).click();
      await page.getByText("別の端末やブラウザーへの同期はできません", { exact: false }).waitFor();
      await page.getByText("公開環境でのアクセスログの扱いは、現在確認中です。", { exact: false }).waitFor();
      await page.getByRole("button", { name: "端末内の記録をすべて削除" }).click();
      await page.getByRole("button", { name: "すべて削除する" }).click();
      assert.strictEqual(await page.evaluate((k) => localStorage.getItem(k), KEY), null);
      await page.getByText("お気に入りに保存したカード（現在 0 件）").waitFor();
    });
    await context.close();
  }

  // --- 3. 5問の診断 --------------------------------------------------------
  {
    const { context, page, requests, errors } = await newPage(browser);

    await step("冒頭文の表示", async () => {
      await page.getByRole("button", { name: "5問のチェックを始める" }).click();
      await page
        .getByText("最近の調べものや報告書づくりを思い浮かべて、今の自分に近いものを選んでください。正解・不正解はありません。")
        .waitFor();
    });

    await step("未回答では進めずエラーを表示", async () => {
      await page.getByRole("button", { name: "始める" }).click();
      await page.getByRole("button", { name: "次へ →" }).click();
      await page.getByRole("alert").getByText("いずれか1つを選んでから進んでください。").waitFor();
      assert.ok((await page.locator(".progress__label").textContent()).includes("1問目"));
    });

    await step("戻る操作（アプリ内・ブラウザー）で設問と回答を保持", async () => {
      const q1 = await page.locator(".question__text").textContent();
      await page.locator('input[value="sometimes"]').check();
      await page.getByRole("button", { name: "次へ →" }).click();
      const q2 = await page.locator(".question__text").textContent();
      await page.locator('input[value="notyet"]').check();
      await page.getByRole("button", { name: "次へ →" }).click();

      await page.getByRole("button", { name: "← 前の質問" }).click();
      assert.strictEqual(await page.locator(".question__text").textContent(), q2);
      assert.ok(await page.locator('input[value="notyet"]').isChecked());

      await page.goBack();
      assert.strictEqual(await page.locator(".question__text").textContent(), q1);
      assert.ok(await page.locator('input[value="sometimes"]').isChecked());
      assert.strictEqual(page.url(), BASE);
    });
    await context.close();

    // 出題が各分野1問・表示順どおりであることを複数回確認
    await step("各分野から1問ずつ、目的→問い→情報整理→根拠確認→骨子の順で出題（20回）", async () => {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await p.goto(BASE);
      const counts = {};
      for (let n = 0; n < 20; n++) {
        const r = await p.evaluate(() => {
          const g = window.__researchGuide;
          const ids = g.drawQuestions();
          return ids;
        });
        assert.strictEqual(r.length, 5);
        r.forEach((id, i) => {
          assert.strictEqual(id[0], "ABCDE"[i]);
          counts[id] = (counts[id] || 0) + 1;
        });
      }
      assert.ok(Object.keys(counts).length > 5, "ランダムに異なる設問が選ばれる");
      await ctx.close();
    });

    assert.deepStrictEqual(errors, []);
  }

  // --- 結果の分岐 ----------------------------------------------------------
  async function resultFor(values, check) {
    const { context, page } = await newPage(browser);
    await page.getByRole("button", { name: "5問のチェックを始める" }).click();
    const labels = await answerQuiz(page, values);
    labels.forEach((l, i) => assert.ok(l.includes(LABELS[i]) && l.includes(i + 1 + "問目"), l));
    assert.strictEqual(await page.locator("h1").textContent(), "次のお仕事で試せそうなこと");
    await page.getByText("能力を認定するものではありません。", { exact: false }).waitFor();
    for (const forbidden of ["点", "位", "レベル", "前回より"]) {
      const body = await page.locator("main").textContent();
      if (forbidden === "点") assert.ok(!/\d+\s*点/.test(body), "総合点を表示しない");
      else if (forbidden === "位") assert.ok(!/\d+\s*位/.test(body), "順位を表示しない");
      else assert.ok(!body.includes(forbidden), forbidden);
    }
    await check(page);
    await context.close();
  }

  await step("「まだあまり」を表示順で優先し、他の候補も閲覧できる", () =>
    resultFor(["sometimes", "always", "notyet", "notyet", "none"], async (page) => {
      const primary = page.locator(".suggestion--primary");
      assert.strictEqual(await primary.locator(".suggestion__area").textContent(), "情報整理");
      assert.ok((await primary.textContent()).includes("情報が多くて、整理できない"));
      const others = await page.locator("h3:has-text('ほかの候補') + details summary").allTextContents();
      assert.ok(others[0].startsWith("根拠確認"));
      await page.getByRole("heading", { name: "これから試せるヒント" }).waitFor();
      assert.ok((await page.locator("details summary").allTextContents()).some((t) => t.startsWith("骨子")));
    })
  );

  await step("「まだあまり」がなければ「することもある」から提案", () =>
    resultFor(["always", "sometimes", "always", "sometimes", "always"], async (page) => {
      assert.strictEqual(await page.locator(".suggestion--primary .suggestion__area").textContent(), "問い");
      assert.ok((await page.locator(".suggestion--primary").textContent()).includes("調べたいことが、うまくまとまらない"));
    })
  );

  await step("根拠確認は出典確認ヒントのみ（指示文・コピーなし）", () =>
    resultFor(["always", "always", "always", "notyet", "always"], async (page) => {
      const primary = page.locator(".suggestion--primary");
      assert.strictEqual(await primary.locator(".suggestion__area").textContent(), "根拠確認");
      await primary.getByText("AIが示したURLや引用も、そのまま信用せず確認します。", { exact: false }).waitFor();
      assert.strictEqual(await page.getByRole("button", { name: "指示文をコピー" }).count(), 0);
      assert.strictEqual(await page.locator(".prompt__text").count(), 0);
    })
  );

  await step("全回答が未経験 → 目的のヒントから案内", () =>
    resultFor(["none", "none", "none", "none", "none"], async (page) => {
      await page.getByRole("heading", { name: "これから試せるヒント" }).waitFor();
      assert.strictEqual(await page.locator(".suggestion--primary .suggestion__area").textContent(), "目的");
      assert.strictEqual(await page.locator("details").count(), 4);
    })
  );

  await step("全回答が「普段から」→ 振り返りの確認リスト", () =>
    resultFor(["always", "always", "always", "always", "always"], async (page) => {
      await page.getByRole("heading", { name: "進め方を振り返る確認リスト" }).waitFor();
      assert.strictEqual(await page.locator(".checklist li").count(), 5);
    })
  );

  await step("「普段から」と未経験のみ → 未経験分野のヒント", () =>
    resultFor(["always", "none", "always", "none", "always"], async (page) => {
      assert.strictEqual(await page.locator(".suggestion--primary .suggestion__area").textContent(), "問い");
      assert.ok((await page.locator("details summary").allTextContents())[0].startsWith("根拠確認"));
    })
  );

  await step("結果は保存を選んだときだけ保存され、トップから開ける", () =>
    resultFor(["notyet", "always", "always", "always", "always"], async (page) => {
      assert.strictEqual(await storedData(page), null);
      await page.getByRole("button", { name: "この結果をブラウザー内に保存" }).click();
      const d = await storedData(page);
      assert.strictEqual(d.latestResult.answers.purpose, "notyet");
      assert.strictEqual(d.latestResult.questionIds.length, 5);
      await page.getByRole("button", { name: "トップに戻る" }).click();
      await page.getByRole("button", { name: "保存した結果を見る" }).click();
      assert.strictEqual(await page.locator(".suggestion--primary .suggestion__area").textContent(), "目的");
      // 関連カードから開き、結果に戻る
      await page.locator(".suggestion--primary .related button").click();
      await page.getByRole("button", { name: "← 結果に戻る" }).click();
      await page.getByRole("heading", { name: "次のお仕事で試せそうなこと", level: 1 }).waitFor();
    })
  );

  await step("computeResult：未回答があれば incomplete", async () => {
    const { context, page } = await newPage(browser);
    const r = await page.evaluate(() => window.__researchGuide.computeResult({ purpose: "always" }));
    assert.strictEqual(r.type, "incomplete");
    assert.deepStrictEqual(r.missing, ["question", "organize", "evidence", "outline"]);
    await context.close();
  });

  // --- 5. 保存失敗・破損 ----------------------------------------------------
  await step("保存データ破損時も閲覧・診断が使える", async () => {
    const { context, page, errors } = await newPage(browser, {
      init: () => {
        if (!sessionStorage.getItem("seeded")) {
          localStorage.setItem("research-report-guide", "{broken");
          sessionStorage.setItem("seeded", "1");
        }
      },
    });
    await page.getByText("端末内の保存データを読み込めなかったため", { exact: false }).waitFor();
    await page.getByRole("button", { name: /AIの回答が/ }).click();
    await page.getByRole("button", { name: "☆ お気に入りに保存" }).click();
    assert.deepStrictEqual((await storedData(page)).favorites, ["refine"]);
    assert.deepStrictEqual(errors, []);
    await context.close();
  });

  await step("localStorage が使えない環境でも閲覧・診断が使える", async () => {
    const { context, page, errors } = await newPage(browser, {
      init: () => {
        Storage.prototype.getItem = () => {
          throw new Error("SecurityError");
        };
        Storage.prototype.setItem = () => {
          throw new Error("SecurityError");
        };
      },
    });
    await page.getByText("この環境ではブラウザー内に保存できません。", { exact: false }).waitFor();
    await page.getByRole("button", { name: /情報が多くて/ }).click();
    await page.getByRole("button", { name: "☆ お気に入りに保存" }).click();
    await page.getByRole("button", { name: "★ お気に入りを解除" }).waitFor();
    await page.getByRole("button", { name: "調査・報告の進め方ガイド" }).click();
    await page.getByRole("button", { name: "5問のチェックを始める" }).click();
    await answerQuiz(page, ["notyet", "notyet", "notyet", "notyet", "notyet"]);
    await page.getByRole("heading", { name: "次のお仕事で試せそうなこと", level: 1 }).waitFor();
    assert.deepStrictEqual(errors, []);
    await context.close();
  });

  await step("書き込みだけ失敗（容量超過など）してもエラーにならない", async () => {
    const { context, page, errors } = await newPage(browser, {
      init: () => {
        Storage.prototype.setItem = () => {
          throw new Error("QuotaExceededError");
        };
      },
    });
    await page.getByRole("button", { name: /調べたいことが/ }).click();
    await page.getByRole("button", { name: "☆ お気に入りに保存" }).click();
    await page.waitForFunction(() => document.getElementById("live").textContent.includes("保存できなかった"));
    assert.deepStrictEqual(errors, []);
    await context.close();
  });

  // --- キーボード操作 -------------------------------------------------------
  await step("キーボードだけで入口→カード→コピー→診断→結果まで操作できる", async () => {
    const { context, page } = await newPage(browser, {
      context: { permissions: ["clipboard-read", "clipboard-write"] },
    });
    const focusedText = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        return el && /^(BUTTON|A|INPUT|SUMMARY)$/.test(el.tagName) ? el.textContent.trim() : "";
      });
    async function tabTo(re, max = 40) {
      for (let i = 0; i < max; i++) {
        await page.keyboard.press("Tab");
        if (re.test((await focusedText()) || "")) return;
      }
      throw new Error("フォーカスが届かない: " + re);
    }
    await tabTo(/情報が多くて/);
    await page.keyboard.press("Enter");
    await tabTo(/^指示文をコピー$/);
    await page.keyboard.press("Enter");
    await page.getByText("指示文をコピーしました。").waitFor();
    await tabTo(/お気に入りに保存/);
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "★ お気に入りを解除" }).waitFor();
    await tabTo(/^試してみた$/);
    await page.keyboard.press("Space");
    // フォーカスは感想の選択肢へ移る。矢印キーで選ぶ
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    assert.strictEqual((await storedData(page)).practice.organize.feedback, "mismatch");

    await tabTo(/トップに戻る/, 60);
    await page.keyboard.press("Enter");
    await tabTo(/^5問のチェックを始める$/);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // 「始める」にフォーカス済み
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab"); // 最初の選択肢へ
      await page.keyboard.press("ArrowDown"); // 2番目（そうすることもある）
      assert.ok((await page.locator(".progress__label").textContent()).includes(i + 1 + "問目"));
      await tabTo(i === 4 ? /結果を見る/ : /次へ/);
      await page.keyboard.press("Enter");
    }
    await page.getByRole("heading", { name: "次のお仕事で試せそうなこと", level: 1 }).waitFor();
    assert.strictEqual(await page.locator(".suggestion--primary .suggestion__area").textContent(), "目的");
    await context.close();
  });

  // --- スマートフォン表示 -----------------------------------------------------
  await step("スマートフォン幅（375px）で横スクロールが発生しない", async () => {
    const { context, page } = await newPage(browser, {
      context: { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    });
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.ok(await noOverflow());
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, "mobile-home.png"), fullPage: true });
    await page.getByRole("button", { name: /調べたいことが/ }).tap();
    assert.ok(await noOverflow());
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, "mobile-card.png"), fullPage: true });
    await page.getByRole("button", { name: "調査・報告の進め方ガイド" }).tap();
    await page.getByRole("button", { name: "5問のチェックを始める" }).tap();
    await page.getByRole("button", { name: "始める" }).tap();
    await page.locator('input[value="notyet"]').check();
    assert.ok(await noOverflow());
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, "mobile-quiz.png"), fullPage: true });
    for (let i = 0; i < 5; i++) {
      await page.locator('input[value="notyet"]').check();
      await page.getByRole("button", { name: i === 4 ? "結果を見る" : "次へ →" }).tap();
    }
    assert.ok(await noOverflow());
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, "mobile-result.png"), fullPage: true });
    await context.close();
  });

  // --- 外向き通信 -----------------------------------------------------------
  await step("外向き通信がない（同一オリジンの静的ファイル3点のみ）", async () => {
    const { context, page, requests } = await newPage(browser, {
      context: { permissions: ["clipboard-read", "clipboard-write"] },
    });
    await page.getByRole("button", { name: /AIの回答が/ }).click();
    await page.getByRole("button", { name: "指示文をコピー" }).click();
    await page.getByRole("button", { name: "☆ お気に入りに保存" }).click();
    await page.getByRole("button", { name: "試してみた", exact: true }).click();
    await page.getByLabel("役立った").check();
    await page.getByRole("button", { name: "調査・報告の進め方ガイド" }).click();
    await page.getByRole("button", { name: "5問のチェックを始める" }).click();
    await answerQuiz(page, ["notyet", "sometimes", "none", "always", "notyet"]);
    await page.getByRole("button", { name: "この結果をブラウザー内に保存" }).click();
    await page.getByRole("button", { name: "端末内の記録について・まとめて削除" }).click();
    await page.waitForTimeout(300);
    const unique = [...new Set(requests)];
    unique.forEach((u) => {
      const url = new URL(u);
      assert.strictEqual(url.origin, origin, "外部への通信: " + u);
      assert.strictEqual(url.search, "", "クエリ付き通信: " + u);
    });
    const paths = unique.map((u) => new URL(u).pathname).sort();
    assert.deepStrictEqual(paths.filter((p) => p !== "/favicon.ico"), ["/app.js", "/index.html", "/styles.css"]);
    assert.strictEqual(page.url(), BASE);
    console.log("     通信先: " + unique.join(", "));
    await context.close();
  });

  await step("CSP が fetch を遮断する（connect-src 'none'）", async () => {
    const { context, page } = await newPage(browser);
    const blocked = await page.evaluate(() =>
      fetch("/index.html").then(
        () => false,
        () => true
      )
    );
    assert.ok(blocked);
    await context.close();
  });

  await step("ソースに外部通信 API・外部 URL がない", async () => {
    const dir = path.join(__dirname, "..");
    const src = ["index.html", "app.js", "styles.css"].map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
    for (const pat of [/fetch\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/, /https?:\/\//, /@import/, /url\(/]) {
      assert.ok(!pat.test(src), "見つかった: " + pat);
    }
  });

  await browser.close();
  console.log(`\n${passed} 件の確認がすべて成功しました。`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
