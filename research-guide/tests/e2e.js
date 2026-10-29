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

const openCategory = (page, id) => page.locator(`[data-category="${id}"]`).click();

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

    await step("トップ見出し・2つのカテゴリ・お気に入り・有料の見本ページ導線", async () => {
      assert.strictEqual(await page.locator("h1").textContent(), "今日は、どのお仕事を進めますか？");
      const cats = await page.locator(".entry__title").allTextContents();
      assert.deepStrictEqual(cats, ["情報収集・報告書づくり", "Excel作業"]);
      await page.getByRole("heading", { name: "お気に入り" }).waitFor();
      await page.getByRole("button", { name: "有料でできること（準備中）" }).waitFor();
      assert.strictEqual(await page.getByRole("button", { name: "5問のチェックを始める" }).count(), 0);
    });

    await step("情報収集・報告書づくり：4つの入口と5問のチェック導線", async () => {
      await openCategory(page, "research");
      assert.strictEqual(await page.locator("h1").textContent(), "お仕事で、どこに迷っていますか？");
      const entries = await page.locator(".entry__text").allTextContents();
      assert.deepStrictEqual(entries, [
        "調べたいことが、うまくまとまらない",
        "情報が多くて、整理できない",
        "AIの回答が、しっくりこない",
        "報告書の流れが、決まらない",
      ]);
      await page.getByRole("heading", { name: "どこから始めるか迷ったら、5問のチェック" }).waitFor();
    });

    await step("アプリ名・試作版表示・送信しない旨の説明", async () => {
      assert.strictEqual(await page.title(), "お仕事の進め方ガイド（試作版）");
      assert.strictEqual((await page.locator(".site-title").textContent()).trim(), "お仕事の進め方ガイド");
      await page.locator(".badge-trial", { hasText: "試作版" }).waitFor();
      await page.getByText("診断の回答や実践記録はサーバーへ送信しません。", { exact: false }).first().waitFor();
      const all = await page.evaluate(() => document.documentElement.outerHTML);
      assert.ok(!/個人情報を(一切)?扱(わ|い)ない/.test(all), "包括的な個人情報の表示をしない");
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
      for (const name of ["指示文をコピー", "☆ お気に入りに保存", "試してみた", "ほかの困りごとを見る"]) {
        await page.getByRole("button", { name, exact: true }).waitFor();
      }
      await page.getByText("個人情報や社外秘の情報は追記しないでください。", { exact: false }).waitFor();
    });

    await step("コピー対象は指示文本体だけ", async () => {
      const expected = (await page.locator(".prompt__text").textContent()).trim();
      await page.getByRole("button", { name: "指示文をコピー" }).click();
      await page.getByText("指示文をコピーしました。").waitFor();
      await page.getByText("次に：普段お使いの生成AI（職場で利用が認められたもの）に貼り付け、続けて報告の目的とメモを伝えてください。").waitFor();
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
      await openCategory(page, "research");
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
      await openCategory(page, "research");
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

    await step("「少し合わなかった」で聞き方を調整するカードを案内", async () => {
      const link = page.getByRole("button", { name: "聞き方を調整したいときはこちら →" });
      assert.ok(await link.isVisible());
      await page.getByLabel("役立った").check();
      assert.ok(!(await link.isVisible()));
      await page.getByLabel("少し合わなかった").check();
      await link.click();
      assert.strictEqual(await page.locator("h1").textContent(), "AIの回答が、しっくりこない");
      await page.goBack();
      assert.strictEqual(await page.locator("h1").textContent(), "情報が多くて、整理できない");
    });

    await step("ほかの困りごとを見る → ほかのカードへ", async () => {
      await page.getByRole("button", { name: "ほかの困りごとを見る" }).click();
      await page.getByRole("heading", { name: "ほかの困りごと" }).waitFor();
      assert.strictEqual(await page.locator(".alt .fav-item").count(), 4);
    });

    await step("再読み込み後もお気に入りがトップに表示される", async () => {
      await page.reload();
      await page.getByRole("button", { name: "お仕事の進め方ガイド" }).click();
      const favs = await page.locator(".fav-list .fav-item").allTextContents();
      assert.strictEqual(favs.length, 1);
      assert.ok(favs[0].includes("情報が多くて、整理できない"));
      assert.ok(favs[0].includes("情報収集・報告書づくり"), "所属カテゴリを併記");
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

  // --- 2カテゴリ・8カード ---------------------------------------------------
  {
    const { context, page, errors } = await newPage(browser, {
      context: { permissions: ["clipboard-read", "clipboard-write"] },
    });
    const EXPECTED = {
      research: ["調べたいことが、うまくまとまらない", "情報が多くて、整理できない", "AIの回答が、しっくりこない", "報告書の流れが、決まらない"],
      excel: ["使いたい関数が、分からない", "数式のエラーを、解消したい", "集計の進め方に、迷っている", "表を見やすく、整えたい"],
    };
    const CAT_TITLE = { research: "情報収集・報告書づくり", excel: "Excel作業" };

    await step("2カテゴリ・計8カードへ、トップ→カテゴリ→困りごと→カードで移動できる", async () => {
      for (const cat of ["research", "excel"]) {
        for (let i = 0; i < 4; i++) {
          await page.getByRole("button", { name: "お仕事の進め方ガイド" }).click();
          await openCategory(page, cat);
          const entries = await page.locator(".entry__text").allTextContents();
          assert.deepStrictEqual(entries, EXPECTED[cat]);
          await page.locator(".entry").nth(i).click();
          assert.strictEqual(await page.locator("h1").textContent(), EXPECTED[cat][i]);
          await page.getByRole("heading", { name: "次のお仕事で試せそうなこと" }).waitFor();
          await page.getByRole("heading", { name: "回答を見るポイント" }).waitFor();
          for (const name of ["指示文をコピー", "☆ お気に入りに保存", "試してみた", "ほかの困りごとを見る"]) {
            await page.getByRole("button", { name, exact: true }).waitFor();
          }
          // パンくず：所属カテゴリへ戻れる
          assert.strictEqual(await page.locator("[data-crumb-category]").textContent(), CAT_TITLE[cat]);
          await page.locator("[data-crumb-category]").click();
          assert.ok((await page.locator(".entry__text").allTextContents()).includes(EXPECTED[cat][i]));
          await page.locator(".entry").nth(i).click();
          // パンくず：トップへ戻れる
          await page.getByRole("button", { name: "トップ", exact: true }).click();
          assert.strictEqual(await page.locator("h1").textContent(), "今日は、どのお仕事を進めますか？");
        }
      }
    });

    await step("Excelカード：コピー・ほかの困りごと（同じカテゴリ内）・注意書き", async () => {
      await openCategory(page, "excel");
      await page.getByRole("button", { name: /数式のエラーを/ }).click();
      const expected = (await page.locator(".prompt__text").textContent()).trim();
      await page.getByRole("button", { name: "指示文をコピー" }).click();
      await page.getByText("指示文をコピーしました。").waitFor();
      assert.strictEqual(await page.evaluate(() => navigator.clipboard.readText()), expected);
      assert.ok(expected.startsWith("Excelの数式エラーについて相談します。"));
      assert.ok(expected.endsWith("情報が足りなければ、原因を断定せず追加で質問してください。"));
      await page
        .getByText("次に：普段お使いの生成AIに貼り付け、エラー表示と期待する結果を伝えてください。数式を共有する場合は、機密情報を含まない架空の例に置き換えましょう。")
        .waitFor();
      await page.getByText("提案された操作や数式は、元のファイルのコピーで試し、結果を確認してから反映しましょう。").waitFor();
      await page.getByText("このアプリに、ファイルや実データを入力する必要はありません。").waitFor();
      await page.getByRole("button", { name: "ほかの困りごとを見る" }).click();
      const alts = await page.locator(".alt .fav-item").allTextContents();
      assert.deepStrictEqual(alts, ["使いたい関数が、分からない", "集計の進め方に、迷っている", "表を見やすく、整えたい"]);
      assert.strictEqual(await page.getByRole("button", { name: "5問のチェックを始める" }).count(), 0);
    });

    await step("Excelカテゴリには診断を置かない", async () => {
      await page.getByRole("button", { name: "トップ", exact: true }).click();
      await openCategory(page, "excel");
      assert.strictEqual(await page.getByText("5問のチェック").count(), 0);
    });

    await step("トップのお気に入りに両カテゴリをまとめて表示し、所属カテゴリを併記", async () => {
      await page.getByRole("button", { name: /表を見やすく/ }).click();
      await page.getByRole("button", { name: "☆ お気に入りに保存" }).click();
      await page.getByRole("button", { name: "試してみた", exact: true }).click();
      await page.locator("[data-crumb-category]").click(); // Excel作業へ
      await page.getByRole("button", { name: "トップに戻る" }).click();
      await openCategory(page, "research");
      await page.getByRole("button", { name: /報告書の流れが/ }).click();
      await page.getByRole("button", { name: "☆ お気に入りに保存" }).click();
      await page.getByRole("button", { name: "トップ", exact: true }).click();
      const items = page.locator(".fav-list .fav-item");
      assert.strictEqual(await items.count(), 2);
      assert.deepStrictEqual(await page.locator(".fav-item__category").allTextContents(), ["Excel作業", "情報収集・報告書づくり"]);
      assert.ok((await items.nth(0).textContent()).includes("試してみた"));
      await items.nth(0).click();
      assert.strictEqual(await page.locator("h1").textContent(), "表を見やすく、整えたい");
      assert.strictEqual(await page.locator("[data-crumb-category]").textContent(), "Excel作業");
    });

    await step("ブラウザーの戻るでカード→カテゴリ→トップと戻れる", async () => {
      await page.getByRole("button", { name: "トップ", exact: true }).click();
      await openCategory(page, "excel");
      await page.getByRole("button", { name: /使いたい関数が/ }).click();
      await page.goBack();
      assert.strictEqual(await page.locator("h1").textContent(), "Excel作業の、どこに迷っていますか？");
      await page.goBack();
      assert.strictEqual(await page.locator("h1").textContent(), "今日は、どのお仕事を進めますか？");
      assert.strictEqual(page.url(), BASE);
    });

    assert.deepStrictEqual(errors, []);
    await context.close();
  }

  // --- 既存の保存記録の引き継ぎ ----------------------------------------------
  await step("以前の版で保存したお気に入り・記録・診断結果がそのまま使える", async () => {
    const legacy = {
      schemaVersion: 1,
      favorites: ["organize", "scope"],
      practice: { organize: { tried: true, feedback: "helpful" }, outline: { tried: true, feedback: null } },
      latestResult: {
        questionIds: ["A2", "B1", "C3", "D2", "E1"],
        answers: { purpose: "always", question: "notyet", organize: "sometimes", evidence: "none", outline: "always" },
        savedOn: "2026-10-01",
      },
    };
    const { context, page, errors } = await newPage(browser);
    await page.evaluate((d) => localStorage.setItem("research-report-guide", d), JSON.stringify(legacy));
    await page.reload();
    assert.strictEqual(await page.locator("#storage-notice").isVisible(), false);
    const favs = await page.locator(".fav-list .fav-item").allTextContents();
    assert.strictEqual(favs.length, 2);
    assert.ok(favs[0].includes("情報が多くて、整理できない") && favs[0].includes("試してみた"));
    assert.ok(favs[1].includes("調べたいことが、うまくまとまらない"));
    await openCategory(page, "research");
    await page.getByRole("button", { name: "保存した結果を見る" }).click();
    await page.getByText("2026-10-01 保存", { exact: false }).waitFor();
    assert.strictEqual(await page.locator(".suggestion--primary .suggestion__area").textContent(), "問い");
    const after = await storedData(page);
    assert.deepStrictEqual(after, legacy, "読み込みだけでは保存データを書き換えない");
    assert.deepStrictEqual(errors, []);
    await context.close();
  });

  // --- 有料機能の見本ページ ---------------------------------------------------
  await step("有料でできること（準備中）：構想と無料との違いを示し、購入・登録の操作はない", async () => {
    const { context, page, requests } = await newPage(browser);
    await page.getByRole("button", { name: "有料でできること（準備中）" }).click();
    assert.strictEqual(await page.locator("h1").textContent(), "有料でできること（準備中）");
    await page.getByRole("heading", { name: "構想1：条件に合わせた作業ガイド" }).waitFor();
    await page.getByRole("heading", { name: "構想2：追加カテゴリ" }).waitFor();
    await page.getByRole("heading", { name: "無料で使える機能との違い" }).waitFor();
    await page.getByText("現在、有料機能の購入や会員登録はできません。", { exact: false }).waitFor();
    const body = await page.locator("main").textContent();
    assert.ok(!/[0-9０-９]+\s*円|¥|\$/.test(body), "価格を記載しない");
    assert.ok(!/\d{4}年|\d+月(頃|ごろ|予定)|公開予定日/.test(body), "公開予定日を記載しない");
    const buttons = await page.locator("main button").allTextContents();
    for (const t of buttons) assert.ok(!/購入|登録|ログイン|申し込|アンロック|支払/.test(t), "購入系の操作: " + t);
    assert.strictEqual(await page.locator("main a[href]").count(), 0, "外部リンクなし");
    await page.getByRole("button", { name: "無料のカードを使う（トップへ）" }).click();
    assert.strictEqual(await page.locator("h1").textContent(), "今日は、どのお仕事を進めますか？");
    await context.close();
  });

  // --- 3. 5問の診断 --------------------------------------------------------
  {
    const { context, page, requests, errors } = await newPage(browser);

    await step("冒頭文の表示", async () => {
      await openCategory(page, "research");
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
    await openCategory(page, "research");
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
      await page.getByRole("button", { name: "「情報収集・報告書づくり」に戻る" }).click();
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
    await openCategory(page, "research");
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
    await openCategory(page, "research");
    await page.getByRole("button", { name: /情報が多くて/ }).click();
    await page.getByRole("button", { name: "☆ お気に入りに保存" }).click();
    await page.getByRole("button", { name: "★ お気に入りを解除" }).waitFor();
    await page.locator("[data-crumb-category]").click();
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
    await openCategory(page, "excel");
    await page.getByRole("button", { name: /使いたい関数が/ }).click();
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
    await tabTo(/^情報収集・報告書づくり/);
    await page.keyboard.press("Enter");
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

    await tabTo(/^情報収集・報告書づくり$/, 60); // パンくずの所属カテゴリ
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

    // Excel作業もキーボードだけで：トップ → カテゴリ → カード → お気に入り
    await tabTo(/^トップに戻る$/, 60);
    await page.keyboard.press("Enter");
    await tabTo(/^Excel作業/);
    await page.keyboard.press("Enter");
    await tabTo(/数式のエラーを/);
    await page.keyboard.press("Enter");
    await tabTo(/お気に入りに保存/);
    await page.keyboard.press("Enter");
    assert.deepStrictEqual((await storedData(page)).favorites, ["organize", "excel-error"]);
    await tabTo(/^トップ$/, 60);
    await page.keyboard.press("Enter");
    assert.strictEqual(await page.locator("h1").textContent(), "今日は、どのお仕事を進めますか？");
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
    await page.locator('[data-category="excel"]').tap();
    assert.ok(await noOverflow());
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, "mobile-excel.png"), fullPage: true });
    await page.getByRole("button", { name: /集計の進め方に/ }).tap();
    assert.ok(await noOverflow());
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, "mobile-excel-card.png"), fullPage: true });
    await page.getByRole("button", { name: "トップ", exact: true }).tap();
    await page.getByRole("button", { name: "有料でできること（準備中）" }).tap();
    assert.ok(await noOverflow());
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, "mobile-paid.png"), fullPage: true });
    await page.getByRole("button", { name: "お仕事の進め方ガイド" }).tap();
    await page.locator('[data-category="research"]').tap();
    await page.getByRole("button", { name: /調べたいことが/ }).tap();
    assert.ok(await noOverflow());
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, "mobile-card.png"), fullPage: true });
    await page.locator("[data-crumb-category]").tap();
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
    await openCategory(page, "excel");
    await page.getByRole("button", { name: /表を見やすく/ }).click();
    await page.getByRole("button", { name: "指示文をコピー" }).click();
    await page.getByRole("button", { name: "☆ お気に入りに保存" }).click();
    await page.getByRole("button", { name: "試してみた", exact: true }).click();
    await page.getByLabel("役立った").check();
    await page.getByRole("button", { name: "トップ", exact: true }).click();
    await page.getByRole("button", { name: "有料でできること（準備中）" }).click();
    await page.getByRole("button", { name: "お仕事の進め方ガイド" }).click();
    await openCategory(page, "research");
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
