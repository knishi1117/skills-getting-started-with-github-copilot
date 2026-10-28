/*
 * 調査・報告の進め方ガイド（試作版）
 *
 * - 外部ライブラリ・外部通信なし（fetch / XHR / 解析タグを使わない）
 * - 画面の状態はメモリと history.state（画面名・カードID・設問番号のみ）で管理し、URL は変更しない
 * - お気に入り・実践記録・保存を選んだ診断結果だけを localStorage に保存する
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // コンテンツ
  // ---------------------------------------------------------------------------

  const CARDS = [
    {
      id: "scope",
      title: "調べたいことが、うまくまとまらない",
      action: "「誰に・何のために・いつまでの変化を伝えるか」を仮置きしてみましょう。",
      prompt:
        "これから調べたいテーマを伝えます。調査範囲を絞るために、報告相手・報告の目的・対象期間を、1つずつ質問してください。回答が難しい場合は選択肢を示してください。最後に、調べる問いを3つに整理してください。",
      check: ["問いが広すぎず、調べた結果を報告にどう使うか想像できますか。"],
      nextStep: "普段お使いの生成AI（職場で利用が認められたもの）に貼り付け、続けて調べたいテーマを伝えてください。",
    },
    {
      id: "organize",
      title: "情報が多くて、整理できない",
      action: "報告の目的に直接答える情報を、先に取り出してみましょう。",
      prompt:
        "以下の報告目的と情報をもとに、情報を「目的に直接関係する」「背景として役立つ」「今回は優先度が低い」に仮分類し、理由を添えてください。判断できないものは保留にしてください。提供していない事実は追加せず、情報の正しさを確認したとは扱わないでください。",
      check: [
        "分類理由が報告目的に合っていますか。",
        "自分の考えに反する重要な情報が除外されていませんか。",
      ],
      nextStep: "普段お使いの生成AI（職場で利用が認められたもの）に貼り付け、続けて報告の目的と、整理したい情報を伝えてください。",
    },
    {
      id: "refine",
      title: "AIの回答が、しっくりこない",
      action: "答え直してもらう前に、何が足りないかを整理してみましょう。",
      prompt:
        "先ほどの回答を、今回の目的に合う内容へ具体化したいです。追加すると役立つ条件を3つ以内で挙げ、私に1つずつ質問してください。私が伝えていない事情を推測で補わず、不明な点は不明のまま扱ってください。その後、回答を修正してください。",
      check: ["目的に合う内容になりましたか。", "事実や数字が勝手に追加されていませんか。"],
      nextStep: "しっくりこなかった回答が出ている生成AIの画面で、そのやり取りの続きに貼り付けて送ってください。",
    },
    {
      id: "outline",
      title: "報告書の流れが、決まらない",
      action: "見出しごとに「ここで何を伝えるか」を一文添えてみましょう。",
      prompt:
        "以下の報告目的とメモから、報告書の骨子案を作ってください。各章に「見出し」「伝えることを一文で」「使う根拠」「不足している情報」を示してください。結論は仮説として扱い、根拠が足りない部分は無理につなげず、追加確認が必要と記してください。",
      check: ["報告相手の知りたいことに答える順番ですか。", "根拠より強い結論になっていませんか。"],
      nextStep: "普段お使いの生成AI（職場で利用が認められたもの）に貼り付け、続けて報告の目的とメモを伝えてください。",
    },
  ];

  const CARD_BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));

  // 表示順：目的 → 問い → 情報整理 → 根拠確認 → 骨子
  const AREAS = [
    {
      id: "purpose",
      label: "目的",
      suggestion: "「誰が、何を判断するための報告か」を一文にしてみましょう。",
      cardId: "scope",
      questions: [
        ["A1", "調べものを始めるとき、報告を受け取る相手にどう役立ててもらうか、イメージが浮かびます。"],
        ["A2", "調べものをするとき、「ここまで分かれば、いったんまとめられそう」という目安があります。"],
        ["A3", "報告相手が知りたそうなことを、自分なりの言葉で整理しています。"],
      ],
    },
    {
      id: "question",
      label: "問い",
      suggestion: "テーマを対象・期間・観点に分け、調べる問いを3つ作ってみましょう。",
      cardId: "scope",
      questions: [
        ["B1", "「業界の将来」のような広いテーマでも、まず何から調べるか見当がつきます。"],
        ["B2", "AIに調べものを頼むとき、対象や期間、知りたいことを添えています。"],
        ["B3", "AIの回答が少し違うと感じたとき、聞き方を変えながらやり取りしています。"],
      ],
    },
    {
      id: "organize",
      label: "情報整理",
      suggestion: "情報を論点別に分け、どの問いに答える情報か確認してみましょう。",
      cardId: "organize",
      questions: [
        ["C1", "集めた情報を、内容の近いもの同士に分けながら整理しています。"],
        ["C2", "集めた情報の中から、今回の報告に使いたいものを選んでいます。"],
        ["C3", "情報を並べてみると、もう少し調べたい点や、内容の重なりが見えてきます。"],
      ],
    },
    {
      id: "evidence",
      label: "根拠確認",
      suggestion: "重要な主張を1つ選び、元の出典・日付・記載内容を確認してみましょう。",
      cardId: null, // 専用の出典確認ヒントを表示し、指示文は付けない
      questions: [
        ["D1", "AIの回答で報告に使いたい内容があったら、元の情報にも目を通しています。"],
        ["D2", "情報を見るとき、いつ公表され、いつの状況を扱っているかにも目を向けています。"],
        ["D3", "情報を読むとき、事実として示されていることと、予測や意見を分けて捉えています。"],
      ],
    },
    {
      id: "outline",
      label: "骨子",
      suggestion: "各章で伝えることを一文ずつ書き、結論へのつながりを確認してみましょう。",
      cardId: "outline",
      questions: [
        ["E1", "報告書を書くとき、伝えたいことや見出しを先に並べてみています。"],
        ["E2", "見出しを並べたあと、報告の目的に合う流れか見直しています。"],
        ["E3", "報告書の流れを、「伝えたいこと・その根拠・そこから考えられること」で整理しています。"],
      ],
    },
  ];

  const AREA_BY_ID = Object.fromEntries(AREAS.map((a) => [a.id, a]));
  const QUESTION_BY_ID = {};
  AREAS.forEach((area) =>
    area.questions.forEach(([id, text]) => {
      QUESTION_BY_ID[id] = { id, text, areaId: area.id };
    })
  );

  const ANSWERS = [
    { value: "always", label: "普段からそうしている" },
    { value: "sometimes", label: "そうすることもある" },
    { value: "notyet", label: "まだあまりしていない" },
    { value: "none", label: "今は思い浮かばない・経験がない" },
  ];
  const ANSWER_VALUES = ANSWERS.map((a) => a.value);

  const FEEDBACK = [
    { value: "helpful", label: "役立った" },
    { value: "mismatch", label: "少し合わなかった" },
    { value: "unsure", label: "まだ分からない" },
  ];
  const FEEDBACK_VALUES = FEEDBACK.map((f) => f.value);

  const SOURCE_HINT =
    "重要な主張を1つ選び、出典を実際に開いて、記載内容と日付を確かめてみましょう。AIが示したURLや引用も、そのまま信用せず確認します。";

  const REFLECTION_CHECKLIST = [
    "報告相手と、その人が判断することを一文で言えますか。",
    "調べる問いが、対象・期間・観点で絞り込まれていますか。",
    "集めた情報が、どの問いに答えるものか説明できますか。",
    "重要な主張について、出典・日付・記載内容を確かめましたか。",
    "各章で伝えることが、根拠より強い言い方になっていませんか。",
  ];

  const RESULT_NOTE =
    "今回の回答に基づく、仕事の進め方の自己チェックです。能力を認定するものではありません。出題される質問によって結果が変わるため、前回との点数比較には使いません。";

  const RESULT_HEADING = "次のお仕事で試せそうなこと";

  // ---------------------------------------------------------------------------
  // 端末内の保存（localStorage）
  // ---------------------------------------------------------------------------

  const STORAGE_KEY = "research-report-guide";
  const SCHEMA_VERSION = 1;

  function emptyData() {
    return { schemaVersion: SCHEMA_VERSION, favorites: [], practice: {}, latestResult: null };
  }

  // 保存データを検証し、想定外の値は取り除く。形が壊れていれば null を返す。
  function sanitize(raw) {
    if (!raw || typeof raw !== "object" || raw.schemaVersion !== SCHEMA_VERSION) return null;
    const data = emptyData();
    if (Array.isArray(raw.favorites)) {
      data.favorites = raw.favorites.filter((id, i, arr) => CARD_BY_ID[id] && arr.indexOf(id) === i);
    }
    if (raw.practice && typeof raw.practice === "object") {
      Object.keys(raw.practice).forEach((id) => {
        const entry = raw.practice[id];
        if (!CARD_BY_ID[id] || !entry || entry.tried !== true) return;
        data.practice[id] = {
          tried: true,
          feedback: FEEDBACK_VALUES.includes(entry.feedback) ? entry.feedback : null,
        };
      });
    }
    data.latestResult = sanitizeResult(raw.latestResult);
    return data;
  }

  function sanitizeResult(r) {
    if (!r || typeof r !== "object" || !Array.isArray(r.questionIds) || !r.answers) return null;
    if (r.questionIds.length !== AREAS.length) return null;
    const ok = AREAS.every((area, i) => {
      const q = QUESTION_BY_ID[r.questionIds[i]];
      return q && q.areaId === area.id && ANSWER_VALUES.includes(r.answers[area.id]);
    });
    if (!ok) return null;
    const answers = {};
    AREAS.forEach((a) => (answers[a.id] = r.answers[a.id]));
    const savedOn = typeof r.savedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.savedOn) ? r.savedOn : null;
    return { questionIds: r.questionIds.slice(), answers, savedOn };
  }

  const store = {
    available: true, // localStorage に書き込めるか
    data: emptyData(),

    load() {
      let text;
      try {
        text = window.localStorage.getItem(STORAGE_KEY);
      } catch (e) {
        this.available = false;
        showStorageNotice(
          "この環境ではブラウザー内に保存できません。カードの閲覧と5問のチェックは利用できますが、お気に入りや記録はページを閉じると消えます。"
        );
        return;
      }
      if (text === null) return;
      let parsed = null;
      try {
        parsed = sanitize(JSON.parse(text));
      } catch (e) {
        parsed = null;
      }
      if (parsed) {
        this.data = parsed;
      } else {
        // 破損データは使わずに初期状態で動かす。削除は利用者の操作に任せる。
        showStorageNotice(
          "端末内の保存データを読み込めなかったため、初期状態で表示しています。「端末内の記録について・まとめて削除」から古いデータを削除できます。"
        );
      }
    },

    // 保存に失敗しても画面上の状態（メモリ）は保持する
    save() {
      if (!this.available) return false;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        return true;
      } catch (e) {
        announce("ブラウザー内に保存できませんでした。この画面を閉じると、今回の変更は消えます。");
        return false;
      }
    },

    clearAll() {
      this.data = emptyData();
      if (!this.available) return true;
      try {
        window.localStorage.removeItem(STORAGE_KEY);
        return true;
      } catch (e) {
        return false;
      }
    },

    isFavorite(id) {
      return this.data.favorites.includes(id);
    },
    toggleFavorite(id) {
      const favs = this.data.favorites;
      const i = favs.indexOf(id);
      if (i >= 0) favs.splice(i, 1);
      else favs.push(id);
      return this.save();
    },
    practiceOf(id) {
      return this.data.practice[id] || null;
    },
    setTried(id, tried) {
      if (tried) this.data.practice[id] = { tried: true, feedback: null };
      else delete this.data.practice[id];
      return this.save();
    },
    setFeedback(id, feedback) {
      if (!this.data.practice[id]) this.data.practice[id] = { tried: true, feedback: null };
      this.data.practice[id].feedback = feedback;
      return this.save();
    },
    saveResult(quiz) {
      this.data.latestResult = {
        questionIds: quiz.questionIds.slice(),
        answers: Object.assign({}, quiz.answers),
        savedOn: todayString(),
      };
      return this.save();
    },
    deleteResult() {
      this.data.latestResult = null;
      return this.save();
    },
  };

  function todayString() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  // ---------------------------------------------------------------------------
  // 診断ロジック
  // ---------------------------------------------------------------------------

  // 各分野から1問ずつランダムに選ぶ（開始時に固定）
  function drawQuestions() {
    return AREAS.map((area) => {
      const i = Math.floor(Math.random() * area.questions.length);
      return area.questions[i][0];
    });
  }

  /*
   * 結果の分岐
   * - incomplete : 未回答の分野がある
   * - allNone    : 全回答が「経験がない」→ 目的のヒントから案内
   * - allAlways  : 全回答が「普段から」→ 振り返りの確認リスト
   * - suggest    : 「まだあまり」→ なければ「することもある」の分野を表示順で提案
   * - hintsOnly  : 「普段から」と「経験がない」だけ → 未経験分野のヒントを案内
   * 未経験の分野は低評価に含めず、hints として別に表示する。
   */
  function computeResult(answers) {
    const ids = AREAS.map((a) => a.id);
    const missing = ids.filter((id) => !ANSWER_VALUES.includes(answers[id]));
    if (missing.length) return { type: "incomplete", missing };

    const by = (v) => ids.filter((id) => answers[id] === v);
    const none = by("none");
    const always = by("always");

    if (none.length === ids.length) {
      return { type: "allNone", primary: "purpose", others: [], hints: ids.filter((id) => id !== "purpose") };
    }
    if (always.length === ids.length) {
      return { type: "allAlways", primary: null, others: [], hints: [] };
    }
    const notyet = by("notyet");
    const candidates = notyet.length ? notyet : by("sometimes");
    if (candidates.length) {
      return { type: "suggest", primary: candidates[0], others: candidates.slice(1), hints: none };
    }
    return { type: "hintsOnly", primary: none[0], others: [], hints: none.slice(1) };
  }

  // ---------------------------------------------------------------------------
  // 画面の状態
  // ---------------------------------------------------------------------------

  const state = {
    view: "home", // home | card | quizIntro | quiz | result | data
    cardId: null,
    cardFrom: null, // カードを開いた元の画面（"result" のとき「結果に戻る」を出す）
    quiz: null, // { questionIds, answers, index }
    resultSource: "current", // current | saved
    showAlternatives: false,
    confirmDelete: false,
    quizError: false,
  };

  // URL は変えずに、ブラウザーの戻る操作で画面を戻れるようにする。
  // history.state には画面名・カードID・設問番号だけを入れ、回答内容は入れない。
  function navigate(view, extra) {
    Object.assign(state, { view, showAlternatives: false, confirmDelete: false, quizError: false }, extra || {});
    try {
      history.pushState(historyEntry(), "");
    } catch (e) {
      /* history が使えなくてもアプリ内の操作は続けられる */
    }
    render();
  }

  function historyEntry() {
    return {
      app: "research-guide",
      view: state.view,
      cardId: state.cardId,
      cardFrom: state.cardFrom,
      quizIndex: state.quiz ? state.quiz.index : null,
      resultSource: state.resultSource,
    };
  }

  window.addEventListener("popstate", (event) => {
    const s = event.state;
    if (!s || s.app !== "research-guide") {
      Object.assign(state, { view: "home" });
    } else {
      Object.assign(state, {
        view: s.view,
        cardId: s.cardId,
        cardFrom: s.cardFrom,
        resultSource: s.resultSource || "current",
      });
      if (state.quiz && typeof s.quizIndex === "number") state.quiz.index = s.quizIndex;
    }
    // 再読み込み後などで診断の状態がメモリにない場合は、開始画面に戻す
    if ((state.view === "quiz" || (state.view === "result" && state.resultSource === "current")) && !state.quiz) {
      state.view = "quizIntro";
    }
    if (state.view === "result" && state.resultSource === "saved" && !store.data.latestResult) {
      state.view = "home";
    }
    if (state.view === "card" && !CARD_BY_ID[state.cardId]) state.view = "home";
    Object.assign(state, { showAlternatives: false, confirmDelete: false, quizError: false });
    render();
  });

  // ---------------------------------------------------------------------------
  // DOM ヘルパー（innerHTML を使わずに要素を組み立てる）
  // ---------------------------------------------------------------------------

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((key) => {
        const value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === "class") el.className = value;
        else if (key === "text") el.textContent = value;
        else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
        else el.setAttribute(key, value === true ? "" : value);
      });
    }
    children.flat().forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return el;
  }

  function button(label, onclick, opts) {
    return h("button", Object.assign({ type: "button", class: "btn", onclick }, opts || {}), label);
  }

  const main = document.getElementById("main");
  const live = document.getElementById("live");

  function announce(message) {
    live.textContent = "";
    // 同じ文言でも読み上げられるよう、一度空にしてから設定する
    window.setTimeout(() => (live.textContent = message), 30);
  }

  function showStorageNotice(message) {
    const el = document.getElementById("storage-notice");
    el.textContent = message;
    el.hidden = false;
  }

  // 画面を描き替え、見出しにフォーカスを移す
  function render(focusSelector) {
    main.replaceChildren(VIEWS[state.view]());
    const target = main.querySelector(focusSelector || "[data-focus]") || main.querySelector("h1");
    if (target) {
      if (!target.hasAttribute("tabindex") && !/^(BUTTON|INPUT|A)$/.test(target.tagName)) {
        target.setAttribute("tabindex", "-1");
      }
      target.focus({ preventScroll: false });
    }
    window.scrollTo(0, 0);
  }

  // 一部だけを更新する（フォーカス位置を保つ）
  function rerender(focusSelector) {
    const y = window.scrollY;
    main.replaceChildren(VIEWS[state.view]());
    const target = focusSelector && main.querySelector(focusSelector);
    if (target) target.focus({ preventScroll: true });
    window.scrollTo(0, y);
  }

  // ---------------------------------------------------------------------------
  // コピー
  // ---------------------------------------------------------------------------

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        /* 下の方法を試す */
      }
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.setAttribute("aria-hidden", "true");
      ta.className = "copy-buffer";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function selectElementText(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---------------------------------------------------------------------------
  // 画面：トップ
  // ---------------------------------------------------------------------------

  function viewHome() {
    const favs = store.data.favorites.map((id) => CARD_BY_ID[id]);
    return h(
      "div",
      { class: "view view-home" },
      h("h1", { class: "page-title", text: "お仕事で、どこに迷っていますか？" }),
      h("p", { class: "lead", text: "近いものを選ぶと、次に試せる行動と、生成AIに渡せる指示文が表示されます。" }),
      h(
        "ul",
        { class: "entry-list", "aria-label": "困りごとの入口" },
        CARDS.map((card, i) =>
          h(
            "li",
            null,
            h(
              "button",
              {
                type: "button",
                class: "entry",
                "data-entry": card.id,
                onclick: () => openCard(card.id, "home"),
              },
              h("span", { class: "entry__num", "aria-hidden": "true", text: String(i + 1) }),
              h("span", { class: "entry__text", text: card.title }),
              h("span", { class: "entry__arrow", "aria-hidden": "true", text: "→" })
            )
          )
        )
      ),

      h(
        "section",
        { class: "section", "aria-labelledby": "fav-heading" },
        h("h2", { id: "fav-heading", text: "お気に入り" }),
        favs.length
          ? h(
              "ul",
              { class: "fav-list" },
              favs.map((card) => {
                const p = store.practiceOf(card.id);
                return h(
                  "li",
                  null,
                  h(
                    "button",
                    { type: "button", class: "fav-item", onclick: () => openCard(card.id, "home") },
                    h("span", { text: card.title }),
                    p ? h("span", { class: "tag", text: "試してみた" }) : null
                  )
                );
              })
            )
          : h("p", {
              class: "muted",
              text: "まだお気に入りはありません。カードの「お気に入りに保存」を押すと、ここに表示されます。",
            }),
        h("p", {
          class: "small muted",
          text: "お気に入りや記録は、このブラウザー内だけに保存されます。別の端末への同期や、消えた記録の復元はできません。",
        })
      ),

      h(
        "section",
        { class: "section section--sub", "aria-labelledby": "check-heading" },
        h("h2", { id: "check-heading", class: "h-sub", text: "どこから始めるか迷ったら、5問のチェック" }),
        h("p", {
          class: "small",
          text: "最近の調べものや報告書づくりを振り返る、短い自己チェックです。1〜2分で終わります。",
        }),
        h(
          "div",
          { class: "btn-row" },
          button("5問のチェックを始める", () => navigate("quizIntro"), { class: "btn btn--secondary" }),
          store.data.latestResult
            ? button("保存した結果を見る", () => navigate("result", { resultSource: "saved" }), {
                class: "btn btn--ghost",
              })
            : null
        )
      )
    );
  }

  function openCard(cardId, from) {
    navigate("card", { cardId, cardFrom: from });
  }

  // ---------------------------------------------------------------------------
  // 画面：実用カード
  // ---------------------------------------------------------------------------

  function viewCard() {
    const card = CARD_BY_ID[state.cardId];
    const fav = store.isFavorite(card.id);
    const practice = store.practiceOf(card.id);
    const promptId = "prompt-" + card.id;

    const promptBox = h("p", { id: promptId, class: "prompt__text", text: card.prompt });
    const copyStatus = h("div", { class: "copy-status", role: "status" });

    async function onCopy() {
      const ok = await copyText(card.prompt);
      copyStatus.replaceChildren();
      if (ok) {
        copyStatus.className = "copy-status copy-status--ok";
        copyStatus.append(
          h("strong", { text: "指示文をコピーしました。" }),
          h("span", { class: "copy-status__next", text: "次に：" + card.nextStep }),
          h("span", { class: "copy-status__note", text: "個人情報や社外秘の情報は書き足さないでください。" })
        );
      } else {
        copyStatus.className = "copy-status copy-status--error";
        copyStatus.append(
          h("strong", { text: "自動でコピーできませんでした。" }),
          " 指示文の全文を選択しました。パソコンでは Ctrl+C（Mac は ⌘+C）、スマートフォンでは選択範囲を長押ししてコピーしてください。",
          h(
            "div",
            { class: "btn-row" },
            button("指示文をもう一度選択する", () => selectElementText(promptBox), { class: "btn btn--ghost btn--small" })
          )
        );
        selectElementText(promptBox);
        promptBox.focus();
      }
    }

    function onFavorite() {
      const saved = store.toggleFavorite(card.id);
      rerender("[data-fav]");
      const now = store.isFavorite(card.id);
      announce(
        (now ? "お気に入りに保存しました。" : "お気に入りを解除しました。") +
          (saved ? "" : "（ブラウザー内に保存できなかったため、この画面を閉じると元に戻ります）")
      );
    }

    function onTried() {
      const now = !store.practiceOf(card.id);
      store.setTried(card.id, now);
      rerender(now ? "[data-feedback] input" : "[data-tried]");
      announce(now ? "「試してみた」を記録しました。感想は選ばなくてもかまいません。" : "「試してみた」の記録を取り消しました。");
    }

    function toggleAlternatives() {
      state.showAlternatives = !state.showAlternatives;
      rerender(state.showAlternatives ? "#alt-heading" : "[data-alt]");
    }

    function onFeedback(value) {
      store.setFeedback(card.id, value);
      announce("感想「" + FEEDBACK.find((f) => f.value === value).label + "」を記録しました。");
    }

    return h(
      "div",
      { class: "view view-card" },
      h(
        "nav",
        { class: "crumbs", "aria-label": "戻る" },
        state.cardFrom === "result"
          ? button("← 結果に戻る", () => history.back(), { class: "link-button" })
          : button("← トップに戻る", () => navigate("home"), { class: "link-button" })
      ),
      h("p", { class: "card-kicker", text: "困りごと" }),
      h("h1", { class: "page-title page-title--card", text: card.title }),

      h(
        "article",
        { class: "card", "aria-labelledby": "card-next" },
        h("h2", { id: "card-next", class: "card__heading", text: RESULT_HEADING }),
        h("p", { class: "card__action", text: card.action }),

        h(
          "section",
          { class: "prompt", "aria-labelledby": "prompt-label" },
          h("h3", { id: "prompt-label", text: "コピーできる指示文" }),
          h("div", { class: "prompt__box", tabindex: "0", role: "group", "aria-labelledby": "prompt-label" }, promptBox),
          h(
            "div",
            { class: "btn-row" },
            button("指示文をコピー", onCopy, { class: "btn btn--primary", "data-copy": "" })
          ),
          copyStatus
        ),

        h(
          "section",
          { class: "checkpoints", "aria-labelledby": "check-label" },
          h("h3", { id: "check-label", text: "回答を見るポイント" }),
          h("ul", null, card.check.map((c) => h("li", { text: c })))
        ),

        h(
          "div",
          { class: "btn-row btn-row--actions" },
          button(fav ? "★ お気に入りを解除" : "☆ お気に入りに保存", onFavorite, {
            class: "btn btn--ghost",
            "aria-pressed": fav ? "true" : "false",
            "data-fav": "",
          }),
          button(practice ? "✓ 試してみた（記録済み・押すと取り消し）" : "試してみた", onTried, {
            class: "btn btn--ghost",
            "aria-pressed": practice ? "true" : "false",
            "data-tried": "",
          }),
          button("ほかの困りごとを見る", toggleAlternatives, { class: "btn btn--ghost", "aria-expanded": state.showAlternatives ? "true" : "false", "data-alt": "" })
        ),

        practice ? feedbackFieldset(card.id, practice, onFeedback, toggleAlternatives) : null
      ),

      state.showAlternatives ? alternatives(card.id) : null,
      usageGuide()
    );
  }

  function feedbackFieldset(cardId, practice, onFeedback, onShowAlternatives) {
    // 「少し合わなかった」を選んだときだけ、次に試せる案内を出す
    const mismatchHint =
      cardId === "refine"
        ? h(
            "div",
            { class: "mismatch-hint" },
            h("p", { text: "条件を足しても合わないときは、困りごと自体を見直してみましょう。" }),
            button("ほかの困りごとを見る", onShowAlternatives, { class: "btn btn--secondary btn--small" })
          )
        : h(
            "div",
            { class: "mismatch-hint" },
            h("p", { text: "AIの回答が目的に合わなかったときは、聞き方を調整できます。" }),
            button("聞き方を調整したいときはこちら →", () => openCard("refine", "home"), {
              class: "btn btn--secondary btn--small",
              "data-refine-link": "",
            })
          );
    mismatchHint.hidden = practice.feedback !== "mismatch";

    return h(
      "fieldset",
      { class: "feedback", "data-feedback": "" },
      h("legend", { text: "試してみて、どうでしたか？（任意）" }),
      h(
        "div",
        { class: "choice-row" },
        FEEDBACK.map((f) =>
          h(
            "label",
            { class: "chip" },
            h("input", {
              type: "radio",
              name: "feedback-" + cardId,
              value: f.value,
              checked: practice.feedback === f.value,
              onchange: () => {
                onFeedback(f.value);
                mismatchHint.hidden = f.value !== "mismatch";
              },
            }),
            h("span", { text: f.label })
          )
        )
      ),
      mismatchHint,
      h("p", { class: "small muted", text: "選んだ感想は、このブラウザー内にだけ保存されます。" })
    );
  }

  function alternatives(currentId) {
    return h(
      "section",
      { class: "section alt", "aria-labelledby": "alt-heading" },
      h("h2", { id: "alt-heading", tabindex: "-1", text: "ほかの困りごと" }),
      h(
        "ul",
        { class: "fav-list" },
        CARDS.filter((c) => c.id !== currentId).map((c) =>
          h("li", null, h("button", { type: "button", class: "fav-item", onclick: () => openCard(c.id, "home") }, c.title))
        ),
        h(
          "li",
          null,
          h(
            "button",
            { type: "button", class: "fav-item", onclick: () => navigate("quizIntro") },
            "どこから始めるか迷ったら、5問のチェック"
          )
        )
      )
    );
  }

  function usageGuide() {
    return h(
      "aside",
      { class: "usage", "aria-labelledby": "usage-heading" },
      h("h2", { id: "usage-heading", class: "h-sub", text: "指示文の使い方" }),
      h(
        "ul",
        null,
        h("li", { text: "このアプリには、資料やAIの回答を入力しません。" }),
        h("li", { text: "コピーした指示文は、職場で利用が認められた生成AIに貼り付けて使ってください。" }),
        h("li", {
          text: "指示文に続けて情報を追記するときは、利用先のサービスと職場のルールに従ってください。個人情報や社外秘の情報は追記しないでください。",
        })
      )
    );
  }

  // ---------------------------------------------------------------------------
  // 画面：5問のチェック
  // ---------------------------------------------------------------------------

  function viewQuizIntro() {
    return h(
      "div",
      { class: "view view-quiz-intro" },
      h("nav", { class: "crumbs", "aria-label": "戻る" }, button("← トップに戻る", () => navigate("home"), { class: "link-button" })),
      h("h1", { class: "page-title", text: "5問のチェック" }),
      h("p", {
        class: "lead",
        text: "最近の調べものや報告書づくりを思い浮かべて、今の自分に近いものを選んでください。正解・不正解はありません。",
      }),
      h(
        "ul",
        { class: "small muted plain-list" },
        h("li", { text: "目的・問い・情報整理・根拠確認・骨子から、1問ずつ出題します。" }),
        h("li", { text: "回答はこのページの中だけで扱い、送信しません。結果は、保存を選んだときだけブラウザー内に保存します。" })
      ),
      h("div", { class: "btn-row" }, button("始める", startQuiz, { class: "btn btn--primary", "data-focus": "" }))
    );
  }

  function startQuiz() {
    state.quiz = { questionIds: drawQuestions(), answers: {}, index: 0 };
    navigate("quiz", { resultSource: "current" });
  }

  function viewQuiz() {
    const quiz = state.quiz;
    const total = AREAS.length;
    const area = AREAS[quiz.index];
    const q = QUESTION_BY_ID[quiz.questionIds[quiz.index]];
    const current = quiz.answers[area.id];
    const isLast = quiz.index === total - 1;
    const errorId = "quiz-error";

    function choose(value) {
      quiz.answers[area.id] = value;
      if (state.quizError) {
        state.quizError = false;
        rerender('input[value="' + value + '"]');
      }
    }

    function next() {
      if (!quiz.answers[area.id]) {
        state.quizError = true;
        rerender("#" + errorId);
        return;
      }
      if (isLast) {
        const result = computeResult(quiz.answers);
        if (result.type === "incomplete") {
          // 通常は起こらないが、未回答の設問があれば最初の未回答に戻す
          quiz.index = AREAS.findIndex((a) => a.id === result.missing[0]);
          state.quizError = true;
          navigate("quiz", { quizError: true });
          return;
        }
        navigate("result", { resultSource: "current" });
      } else {
        quiz.index += 1;
        navigate("quiz");
      }
    }

    function back() {
      // ブラウザーの履歴と揃えるため history.back() を使う（回答はメモリに残る）
      history.back();
    }

    return h(
      "div",
      { class: "view view-quiz" },
      h(
        "div",
        { class: "progress" },
        h("p", { class: "progress__label", id: "progress-label" }, total + "問中 " + (quiz.index + 1) + "問目（" + area.label + "）"),
        h("progress", { max: String(total), value: String(quiz.index + 1), "aria-labelledby": "progress-label" })
      ),
      h(
        "form",
        {
          class: "quiz-form",
          novalidate: true,
          onsubmit: (e) => {
            e.preventDefault();
            next();
          },
        },
        h(
          "fieldset",
          { class: "question", "aria-describedby": state.quizError ? errorId : null },
          h("legend", { class: "question__text", "data-focus": "", tabindex: "-1" }, h("span", { class: "visually-hidden", text: "質問：" }), q.text),
          h(
            "div",
            { class: "options" },
            ANSWERS.map((a) =>
              h(
                "label",
                { class: "option" },
                h("input", {
                  type: "radio",
                  name: "answer",
                  value: a.value,
                  checked: current === a.value,
                  onchange: () => choose(a.value),
                }),
                h("span", { class: "option__label", text: a.label })
              )
            )
          ),
          state.quizError
            ? h("p", { id: errorId, class: "field-error", role: "alert", tabindex: "-1", text: "いずれか1つを選んでから進んでください。" })
            : null
        ),
        h(
          "div",
          { class: "btn-row btn-row--quiz" },
          quiz.index > 0
            ? button("← 前の質問", back, { class: "btn btn--ghost" })
            : button("← やめる", () => navigate("home"), { class: "btn btn--ghost" }),
          h("button", { type: "submit", class: "btn btn--primary" }, isLast ? "結果を見る" : "次へ →")
        )
      ),
      h("p", { class: "small muted", text: "前の質問に戻っても、出題と選んだ回答はそのまま残ります。" })
    );
  }

  // ---------------------------------------------------------------------------
  // 画面：結果
  // ---------------------------------------------------------------------------

  function relatedBlock(areaId) {
    const area = AREA_BY_ID[areaId];
    if (!area.cardId) {
      // 根拠確認：専用の出典確認ヒントのみ（指示文は付けない）
      return h(
        "div",
        { class: "related related--hint" },
        h("h4", { text: "出典確認のヒント" }),
        h("p", { text: SOURCE_HINT })
      );
    }
    const card = CARD_BY_ID[area.cardId];
    return h(
      "div",
      { class: "related" },
      h("h4", { text: "関連カード" }),
      h(
        "button",
        { type: "button", class: "fav-item", onclick: () => openCard(card.id, "result") },
        h("span", { text: card.title }),
        h("span", { class: "entry__arrow", "aria-hidden": "true", text: "→" })
      )
    );
  }

  function suggestionBlock(areaId, opts) {
    const area = AREA_BY_ID[areaId];
    return h(
      "div",
      { class: "suggestion" + (opts && opts.primary ? " suggestion--primary" : "") },
      h("p", { class: "suggestion__area", text: area.label }),
      h("p", { class: "suggestion__text", text: area.suggestion }),
      relatedBlock(areaId)
    );
  }

  function collapsibleList(title, ids) {
    if (!ids.length) return null;
    return h(
      "section",
      { class: "section" },
      h("h3", { class: "h-sub", text: title }),
      ids.map((id) =>
        h(
          "details",
          { class: "more" },
          h("summary", { text: AREA_BY_ID[id].label + "：" + AREA_BY_ID[id].suggestion }),
          relatedBlock(id)
        )
      )
    );
  }

  function viewResult() {
    const saved = state.resultSource === "saved";
    const source = saved ? store.data.latestResult : state.quiz;
    const result = computeResult(source.answers);
    const body = [];

    if (result.type === "allAlways") {
      body.push(
        h("p", { text: "どの分野も、普段から取り組んでいると回答しました。次の報告書づくりで、進め方を振り返る確認リストとして使えます。" }),
        h(
          "section",
          { class: "card" },
          h("h3", { text: "進め方を振り返る確認リスト" }),
          h("ul", { class: "checklist" }, REFLECTION_CHECKLIST.map((t) => h("li", { text: t })))
        ),
        h(
          "section",
          { class: "section" },
          h("h3", { class: "h-sub", text: "実用カード" }),
          h(
            "ul",
            { class: "fav-list" },
            CARDS.map((c) => h("li", null, h("button", { type: "button", class: "fav-item", onclick: () => openCard(c.id, "result") }, c.title)))
          )
        )
      );
    } else if (result.type === "allNone" || result.type === "hintsOnly") {
      body.push(
        h("p", {
          text:
            result.type === "allNone"
              ? "まだ思い浮かばない分野が多いときは、報告の目的から考えると始めやすくなります。"
              : "経験がないと回答した分野について、これから試せるヒントです。",
        }),
        h("h3", { class: "h-sub", text: "これから試せるヒント" }),
        suggestionBlock(result.primary, { primary: true }),
        collapsibleList("ほかのヒント", result.hints)
      );
    } else {
      body.push(
        suggestionBlock(result.primary, { primary: true }),
        collapsibleList("ほかの候補", result.others),
        collapsibleList("これから試せるヒント", result.hints)
      );
    }

    function onSave() {
      const ok = store.saveResult(state.quiz);
      rerender("[data-save-status]");
      announce(ok ? "この結果をブラウザー内に保存しました。" : "ブラウザー内に保存できませんでした。");
    }

    const savedNow = !saved && store.data.latestResult && sameResult(store.data.latestResult, state.quiz);

    return h(
      "div",
      { class: "view view-result" },
      h("p", { class: "card-kicker", text: saved ? "保存した結果" + (source.savedOn ? "（" + source.savedOn + " 保存）" : "") : "5問のチェックの結果" }),
      h("h1", { class: "page-title", text: RESULT_HEADING }),
      body,
      h("p", { class: "note", text: RESULT_NOTE }),
      h(
        "div",
        { class: "btn-row" },
        saved
          ? button("保存した結果を削除", () => {
              store.deleteResult();
              announce("保存した結果を削除しました。");
              navigate("home");
            }, { class: "btn btn--ghost" })
          : savedNow
            ? h("p", { class: "small", "data-save-status": "", tabindex: "-1", text: "この結果はブラウザー内に保存済みです。" })
            : button(store.data.latestResult ? "この結果を保存（前回の保存分は置き換え）" : "この結果をブラウザー内に保存", onSave, {
                class: "btn btn--secondary",
                "data-save-status": "",
              }),
        button("もう一度チェックする", startQuiz, { class: "btn btn--ghost" }),
        button("トップに戻る", () => navigate("home"), { class: "btn btn--ghost" })
      ),
      !saved ? h("p", { class: "small muted", text: "保存しない場合、この結果はページを閉じると消えます。保存できるのは最新の1件だけです。" }) : null
    );
  }

  function sameResult(a, b) {
    return a.questionIds.join() === b.questionIds.join() && AREAS.every((x) => a.answers[x.id] === b.answers[x.id]);
  }

  // ---------------------------------------------------------------------------
  // 画面：端末内の記録
  // ---------------------------------------------------------------------------

  function viewData() {
    const d = store.data;
    const triedCount = Object.keys(d.practice).length;
    const feedbackCount = Object.values(d.practice).filter((p) => p.feedback).length;

    function onDelete() {
      if (!state.confirmDelete) {
        state.confirmDelete = true;
        rerender("[data-confirm-delete]");
        return;
      }
      const ok = store.clearAll();
      state.confirmDelete = false;
      if (store.available) document.getElementById("storage-notice").hidden = true;
      rerender("[data-delete-done]");
      announce(ok ? "端末内の記録をすべて削除しました。" : "削除できませんでした。ブラウザーの設定からサイトデータを削除してください。");
    }

    return h(
      "div",
      { class: "view view-data" },
      h("nav", { class: "crumbs", "aria-label": "戻る" }, button("← トップに戻る", () => navigate("home"), { class: "link-button" })),
      h("h1", { class: "page-title", text: "端末内の記録について" }),
      h(
        "section",
        { class: "section" },
        h("h2", { class: "h-sub", text: "保存される場所" }),
        h(
          "ul",
          null,
          h("li", { text: "記録は、このブラウザーの保存領域（localStorage）にだけ保存されます。" }),
          h("li", { text: "別の端末やブラウザーへの同期はできません。ブラウザーのデータを消去すると、記録も消え、復元はできません。" }),
          h("li", { text: "このアプリは、回答・結果・記録をサーバーへ送信しません。アクセス解析や広告のタグも使っていません。" })
        )
      ),
      h(
        "section",
        { class: "section" },
        h("h2", { class: "h-sub", text: "保存される内容" }),
        h(
          "ul",
          null,
          h("li", { text: "お気に入りに保存したカード（現在 " + d.favorites.length + " 件）" }),
          h("li", { text: "カードごとの「試してみた」と、任意で選んだ感想（現在 " + triedCount + " 件、うち感想 " + feedbackCount + " 件）" }),
          h("li", { text: "保存を選んだ最新の診断結果（現在 " + (d.latestResult ? "1 件" : "なし") + "）" })
        ),
        h("p", { class: "small muted", text: "氏名、会社名、業務内容、生成AIに追記した内容は収集しません。入力欄もありません。" }),
        !store.available ? h("p", { class: "notice notice--warn", text: "現在、この環境ではブラウザー内に保存できない状態です。" }) : null
      ),
      h(
        "section",
        { class: "section" },
        h("h2", { class: "h-sub", text: "公開環境について" }),
        h("p", {
          text:
            "このページを配信するサーバーやネットワークでは、一般に、アクセス日時や接続元などのアクセスログが記録される場合があります。公開環境でのアクセスログの扱いは、現在確認中です。",
        })
      ),
      h(
        "section",
        { class: "section danger-zone" },
        h("h2", { class: "h-sub", text: "記録をまとめて削除" }),
        state.confirmDelete
          ? h(
              "div",
              { role: "group", "aria-labelledby": "confirm-text" },
              h("p", { id: "confirm-text", class: "field-error", text: "お気に入り・実践記録・保存した結果をすべて削除します。元に戻せません。よろしいですか？" }),
              h(
                "div",
                { class: "btn-row" },
                button("すべて削除する", onDelete, { class: "btn btn--danger", "data-confirm-delete": "" }),
                button("やめる", () => {
                  state.confirmDelete = false;
                  rerender("[data-delete]");
                }, { class: "btn btn--ghost" })
              )
            )
          : h(
              "div",
              null,
              h("div", { class: "btn-row" }, button("端末内の記録をすべて削除", onDelete, { class: "btn btn--danger", "data-delete": "" })),
              h("p", { class: "small muted", "data-delete-done": "", tabindex: "-1", text: "削除しても、カードの閲覧と5問のチェックはそのまま使えます。" })
            )
      )
    );
  }

  const VIEWS = {
    home: viewHome,
    card: viewCard,
    quizIntro: viewQuizIntro,
    quiz: viewQuiz,
    result: viewResult,
    data: viewData,
  };

  // ---------------------------------------------------------------------------
  // 起動
  // ---------------------------------------------------------------------------

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    if (el.dataset.action === "home") navigate("home");
    if (el.dataset.action === "data") navigate("data");
  });

  store.load();
  try {
    history.replaceState(historyEntry(), "");
  } catch (e) {
    /* noop */
  }
  main.replaceChildren(viewHome());

  // テスト用に純粋関数だけを公開する（通信や保存は行わない）
  window.__researchGuide = { computeResult, drawQuestions, AREAS, SCHEMA_VERSION, STORAGE_KEY };
})();
