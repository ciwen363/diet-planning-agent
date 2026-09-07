(function () {
    "use strict";

    const app = document.getElementById("app");
    const toast = document.getElementById("toast");
    const userIdInput = document.getElementById("userIdInput");
    const currentUserId = document.getElementById("currentUserId");
    const siteNav = document.getElementById("siteNav");
    const menuToggle = document.querySelector("[data-chrome-action='toggle-menu']");
    const toolsButton = document.getElementById("toolsMenuButton");
    const toolsMenu = document.getElementById("toolsMenu");
    const settingsButton = document.getElementById("settingsButton");
    const settingsPanel = document.getElementById("settingsPanel");
    const settingsForm = document.getElementById("settingsForm");

    const SLOT_LABELS = {
        mealTime: "用餐时间",
        mood: "心情状态",
        scene: "用餐场景",
        healthGoal: "健康目标",
        cuisine: "菜系偏好",
        taste: "口味偏好",
        convenience: "便利程度"
    };

    const INTENTS = [
        "MEAL_RECOMMENDATION",
        "CLARIFY_NEEDED",
        "MEAL_ADJUST",
        "MEAL_PLAN",
        "HEALTH_RISK",
        "OTHER"
    ];

    const QUICK_MESSAGES = [
        "早餐想吃方便一点",
        "晚饭推荐清淡低脂的",
        "今天心情一般，想吃点热乎的",
        "换一批，不想吃刚才那些",
        "我胃不舒服，应该吃什么"
    ];

    const METRIC_LABELS = {
        intentAccuracy: "意图准确率",
        slotF1: "槽位 F1",
        clarifyAccuracy: "澄清准确率",
        responseQuality: "回复质量",
        feedbackScore: "用户反馈分",
        latencyScore: "耗时得分"
    };

    const state = {
        ui: {
            route: null,
            navOpen: false,
            toolsOpen: false,
            settingsOpen: false
        },
        home: {
            loaded: false,
            loading: false,
            error: "",
            personalCount: 0,
            publicCount: 0
        },
        slotOptions: null,
        slotOptionsLoading: false,
        slotOptionsError: "",
        personalMeals: [],
        personalMealsLoaded: false,
        personalMealsLoading: false,
        personalMealsError: "",
        publicMeals: [],
        publicMealsLoaded: false,
        publicMealsLoading: false,
        publicMealsError: "",
        publicFilter: {
            query: ""
        },
        editingMeal: null,
        mealDirty: false,
        feedback: {},
        chat: {
            sourceMode: "PERSONAL",
            sessionId: null,
            sending: false,
            draft: "",
            activeRequest: null,
            requestSeq: 0,
            messages: [welcomeMessage()]
        },
        traces: {
            rows: [],
            selected: null,
            loading: false,
            error: "",
            filters: defaultTraceFilters()
        },
        evaluation: {
            report: null,
            loading: false,
            error: "",
            form: defaultRangeForm()
        }
    };

    function uid(prefix) {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function welcomeMessage(text) {
        return {
            id: uid("assistant"),
            role: "assistant",
            kind: "intro",
            text: text || "你好，我可以根据你的个人餐食库或公共餐食库推荐今天吃什么。可以直接告诉我用餐时间、口味、场景或健康目标。"
        };
    }

    function defaultRangeForm() {
        const end = new Date();
        const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
        return {
            startAt: toLocalInputValue(start),
            endAt: toLocalInputValue(end),
            limit: 50,
            includeLlmJudge: false
        };
    }

    function defaultTraceFilters() {
        const range = defaultRangeForm();
        return {
            startAt: range.startAt,
            endAt: range.endAt,
            onlyUnlabeled: false,
            limit: 50,
            sessionId: ""
        };
    }

    function toLocalInputValue(date) {
        const pad = (value) => String(value).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function safeJson(value) {
        if (value === null || value === undefined || value === "") {
            return "";
        }
        try {
            const parsed = typeof value === "string" ? JSON.parse(value) : value;
            return JSON.stringify(parsed, null, 2);
        } catch (error) {
            return String(value);
        }
    }

    function showToast(message, type) {
        toast.textContent = message;
        toast.className = `toast show ${type === "error" ? "error" : ""}`;
        window.clearTimeout(showToast.timer);
        showToast.timer = window.setTimeout(() => {
            toast.className = "toast";
        }, 3200);
    }

    function setLoading(button, loadingText) {
        if (!button) {
            return () => {};
        }
        const oldText = button.textContent;
        button.disabled = true;
        button.textContent = loadingText || "处理中...";
        return () => {
            button.disabled = false;
            button.textContent = oldText;
        };
    }

    async function guard(action, successMessage) {
        try {
            const result = await action();
            if (successMessage) {
                showToast(successMessage);
            }
            return result;
        } catch (error) {
            showToast(error.message || "操作失败", "error");
            throw error;
        }
    }

    function currentRoute() {
        return (location.hash || "#/diet").slice(1).split("?")[0] || "/diet";
    }

    function navigate(route) {
        location.hash = route;
    }

    function setActiveNav(route) {
        document.querySelectorAll("[data-nav]").forEach((item) => {
            item.classList.toggle("active", item.dataset.nav === route);
        });
        if (toolsButton) {
            toolsButton.classList.toggle("active", route.startsWith("/admin/"));
        }
    }

    function render() {
        const route = currentRoute();
        const routeChanged = state.ui.route !== route;

        if (routeChanged && state.ui.route === "/diet/chat" && route !== "/diet/chat") {
            cancelChatRequest({ removePending: true });
        }

        state.ui.route = route;
        setActiveNav(route);
        closeChrome();

        if (route === "/diet") {
            renderHome();
        } else if (route === "/diet/chat") {
            renderChat();
        } else if (route === "/diet/meals/personal") {
            renderPersonalMeals();
        } else if (route === "/diet/meals/public") {
            renderPublicMeals();
        } else if (route === "/admin/traces") {
            renderTraces();
        } else if (route === "/admin/evaluations") {
            renderEvaluations();
        } else {
            navigate("/diet");
        }

        if (routeChanged) {
            window.requestAnimationFrame(() => app.focus({ preventScroll: true }));
        }
    }

    function renderHome() {
        app.innerHTML = `
            <section class="home-workbench">
                <div class="section home-primary">
                    <div class="page-title">
                        <div>
                            <p class="eyebrow">今日推荐</p>
                            <h1>今天想吃什么？</h1>
                            <p>说出时间、心情、口味或健康目标，助手会补齐关键信息，再给出可解释推荐。</p>
                        </div>
                        <div class="home-kcal" aria-label="当前推荐上下文">
                            <span>用户</span>
                            <strong>${escapeHtml(DietApi.getUserId())}</strong>
                        </div>
                    </div>

                    <div class="summary-strip" aria-label="餐食库概览">
                        ${summaryItem("个人库", homeStatValue("personal"), "用于 PERSONAL 推荐")}
                        ${summaryItem("公共库", homeStatValue("public"), "用于快速体验")}
                        ${summaryItem("反馈闭环", "可用", "推荐结果可继续反馈")}
                    </div>

                    <div class="hero-actions">
                        <a class="btn primary" href="#/diet/chat">开始推荐</a>
                        <a class="btn ghost" href="#/diet/meals/personal">维护我的餐食</a>
                        <a class="btn ghost" href="#/diet/meals/public">查看公共餐食</a>
                    </div>
                </div>

                <aside class="grid stats">
                    <div class="section home-flow">
                        <h2>推荐流程</h2>
                        ${stepCard("1", "说需求", "描述这一餐的基本想法。")}
                        ${stepCard("2", "补条件", "缺少关键槽位时先追问。")}
                        ${stepCard("3", "给推荐", "展示餐食并接收反馈。")}
                    </div>
                    <div class="section home-dev">
                        <h2>研发工具</h2>
                        <p class="muted">Trace 与评估功能仍保留，用于排查和迭代。</p>
                        <div class="button-row">
                            <a class="btn ghost compact" href="#/admin/traces">Trace</a>
                            <a class="btn ghost compact" href="#/admin/evaluations">评估</a>
                        </div>
                    </div>
                </aside>
            </section>
            <section class="grid three home-feature-grid">
                ${featureCard("聊天推荐", "按自然语言表达需求，页面会展示澄清、推荐和反馈状态。", "#/diet/chat")}
                ${featureCard("我的餐食", "维护常吃餐食和标签，让 PERSONAL 模式更贴近个人偏好。", "#/diet/meals/personal")}
                ${featureCard("研发工具", "Trace 与批量评估保留在研发入口，用于排查和迭代。", "#/admin/traces")}
            </section>
        `;
        loadHomeStats();
    }

    function summaryItem(label, value, desc) {
        return `
            <div class="summary-item">
                <span>${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
                <small>${escapeHtml(desc)}</small>
            </div>
        `;
    }

    function homeStatValue(type) {
        if (state.home.loading) {
            return "加载中";
        }
        if (state.home.error) {
            return "暂不可用";
        }
        if (!state.home.loaded) {
            return "待加载";
        }
        return type === "personal" ? state.home.personalCount : state.home.publicCount;
    }

    function stepCard(index, title, desc) {
        return `
            <div class="step">
                <strong>${escapeHtml(index)}. ${escapeHtml(title)}</strong>
                <span class="muted">${escapeHtml(desc)}</span>
            </div>
        `;
    }

    function statCard(label, value, desc, error) {
        return `
            <div class="stat-card ${error ? "error" : ""}">
                <span class="muted">${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
                <p class="muted">${escapeHtml(error || desc)}</p>
            </div>
        `;
    }

    function featureCard(title, desc, href) {
        return `
            <article class="card">
                <div class="card-title">
                    <div>
                        <h3>${escapeHtml(title)}</h3>
                        <p>${escapeHtml(desc)}</p>
                    </div>
                </div>
                <a class="btn soft" href="${href}">进入</a>
            </article>
        `;
    }

    async function loadHomeStats() {
        if (state.home.loaded || state.home.loading) {
            return;
        }
        state.home.loading = true;
        try {
            const [personal, publicMeals] = await Promise.all([
                DietApi.listPersonalMeals(),
                DietApi.listPublicMeals()
            ]);
            state.home = {
                loaded: true,
                loading: false,
                error: "",
                personalCount: personal.length,
                publicCount: publicMeals.length
            };
        } catch (error) {
            state.home.loading = false;
            state.home.loaded = true;
            state.home.error = "统计加载失败，不影响继续使用聊天推荐";
        }
        if (currentRoute() === "/diet") {
            renderHome();
        }
    }

    function renderChat(options) {
        const opts = options || {};
        const hasConversation = state.chat.messages.some((message) => message.role === "user");
        app.innerHTML = `
            <section class="chat-layout">
                <div class="section chat-window">
                    ${renderChatHeader()}
                    <div id="messages" class="messages" aria-live="polite">
                        ${state.chat.messages.map(renderMessage).join("")}
                    </div>
                    ${renderComposer()}
                </div>
                <aside class="grid chat-aside">
                    ${renderQuickMessages(hasConversation)}
                    ${renderSessionDetails()}
                    ${renderChatTips()}
                </aside>
            </section>
        `;
        scrollMessagesToBottom();
        if (opts.focusInput) {
            focusChatInput();
        }
    }

    function renderChatHeader() {
        return `
            <div class="page-title">
                <div>
                    <p class="eyebrow">聊天推荐</p>
                    <h1>把需求说出来，推荐结果跟着收敛</h1>
                    <p>当前会话：${state.chat.sessionId ? "已创建" : "发送消息时自动创建"}</p>
                </div>
                <div class="chat-controls">
                    <div class="segmented" role="radiogroup" aria-label="推荐数据源">
                        ${sourceSegment("PERSONAL", "个人库")}
                        ${sourceSegment("PUBLIC", "公共库")}
                    </div>
                    <button class="btn ghost" type="button" data-action="new-session">新会话</button>
                </div>
            </div>
        `;
    }

    function sourceSegment(value, label) {
        const active = state.chat.sourceMode === value;
        return `
            <button class="segment" type="button" role="radio" aria-checked="${active}"
                    data-action="set-source" data-source="${value}">
                ${escapeHtml(label)}
            </button>
        `;
    }

    function renderComposer() {
        return `
            <form id="chatForm" class="composer">
                <label class="sr-only" for="chatMessage">输入饮食需求</label>
                <textarea id="chatMessage" name="message" rows="2"
                          placeholder="例如：今晚想吃清淡一点，最好快手一点"
                          aria-describedby="chatStatus" required>${escapeHtml(state.chat.draft)}</textarea>
                <button class="btn primary" type="submit" ${state.chat.sending ? "disabled" : ""}>
                    ${state.chat.sending ? "处理中..." : "发送"}
                </button>
                <p id="chatStatus" class="composer-status">${state.chat.sending ? "正在理解你的需求，本轮完成前不会重复提交。" : "Enter 可换行，点击发送开始本轮推荐。"}</p>
            </form>
        `;
    }

    function renderQuickMessages(compact) {
        return `
            <section class="card side-section ${compact ? "compact" : ""}">
                <div class="card-title">
                    <div>
                        <h3>快捷问题</h3>
                        <p>${compact ? "继续对话时也可以快速补充条件。" : "点击后填入输入框。"}</p>
                    </div>
                </div>
                <div class="chips">
                    ${QUICK_MESSAGES.map((text) => `<button class="chip" type="button" data-action="quick-message" data-message="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join("")}
                </div>
            </section>
        `;
    }

    function renderSessionDetails() {
        const latest = [...state.chat.messages].reverse().find((message) => message.traceId || message.responseType);
        const sessionId = state.chat.sessionId || "尚未创建";
        const traceId = latest && latest.traceId ? latest.traceId : "";
        return `
            <section class="card side-section">
                <div class="card-title">
                    <div>
                        <h3>本轮详情</h3>
                        <p>技术信息收在这里，不打断主对话。</p>
                    </div>
                </div>
                <div class="grid">
                    <p class="muted small">Session：${escapeHtml(sessionId)}</p>
                    <p class="muted small">模式：${state.chat.sourceMode === "PERSONAL" ? "个人库" : "公共库"}</p>
                    ${traceId ? `<a class="btn ghost compact" href="#/admin/traces" data-action="open-trace" data-trace-id="${escapeHtml(traceId)}">查看本轮 Trace</a>` : `<p class="muted small">Trace：本轮成功返回后显示</p>`}
                </div>
            </section>
        `;
    }

    function renderChatTips() {
        return `
            <section class="card side-section">
                <div class="card-title">
                    <div>
                        <h3>使用提示</h3>
                        <p>PERSONAL 模式依赖你的个人餐食库。</p>
                    </div>
                </div>
                <p class="muted">如果个人库还没有数据，可以先维护餐食，或切换到公共库体验推荐链路。</p>
                <div class="button-row">
                    <a class="btn soft" href="#/diet/meals/personal">维护餐食</a>
                    <a class="btn ghost" href="#/diet/meals/public">看公共库</a>
                </div>
            </section>
        `;
    }

    function renderMessage(message) {
        if (message.kind === "error") {
            return renderErrorMessage(message);
        }

        const mealCards = (message.meals || []).map((meal) => renderMealCard(meal, {
            feedback: true,
            sessionId: message.sessionId
        })).join("");
        const missingSlots = renderMissingSlots(message.missingSlots || []);
        const label = message.role === "user" ? "你" : assistantLabel(message);
        const classes = ["message", message.role, message.kind].filter(Boolean).join(" ");
        const pending = message.kind === "pending"
            ? `<span class="typing" aria-hidden="true"><span></span><span></span><span></span></span>`
            : "";

        return `
            <article class="${classes}">
                <div class="message-label">${escapeHtml(label)}</div>
                <div class="bubble">${pending}<span>${escapeHtml(message.text)}</span></div>
                ${missingSlots}
                ${mealCards ? `<div class="grid">${mealCards}</div>` : ""}
            </article>
        `;
    }

    function assistantLabel(message) {
        if (message.responseType === "CLARIFY") {
            return "饮食助手 · 需要补充";
        }
        if (message.responseType === "ANSWER") {
            return "饮食助手 · 推荐结果";
        }
        if (message.kind === "pending") {
            return "饮食助手";
        }
        return "饮食助手";
    }

    function renderMissingSlots(slots) {
        if (!slots.length) {
            return "";
        }
        return `
            <div class="chips" aria-label="还需要补充的信息">
                <span class="chip selected">还需要</span>
                ${slots.map((slot) => `<span class="chip">${escapeHtml(SLOT_LABELS[slot] || slot)}</span>`).join("")}
            </div>
        `;
    }

    function renderErrorMessage(message) {
        const detail = describeApiError(message.error);
        const raw = errorDetailText(message.error, message.request);
        return `
            <article class="message assistant error">
                <div class="message-label">饮食助手 · 请求失败</div>
                <div class="inline-error" role="alert">
                    <strong>${escapeHtml(detail.title)}</strong>
                    <p>${escapeHtml(detail.message)}</p>
                    <div class="button-row">
                        <button class="btn primary compact" type="button" data-action="retry-chat" data-message-id="${escapeHtml(message.id)}" ${state.chat.sending ? "disabled" : ""}>重试本轮</button>
                        <button class="btn ghost compact" type="button" data-action="restore-chat" data-message-id="${escapeHtml(message.id)}">恢复问题</button>
                    </div>
                    ${raw ? `
                        <details>
                            <summary>开发详情</summary>
                            <pre class="json-box">${escapeHtml(raw)}</pre>
                        </details>
                    ` : ""}
                </div>
            </article>
        `;
    }

    function describeApiError(error) {
        if (!error) {
            return { title: "这轮没有处理成功", message: "请稍后重试，或检查后端服务状态。" };
        }
        if (error.timeout) {
            return { title: "请求超时", message: "后端处理时间过长，本轮没有拿到结果。可以直接重试同一轮。" };
        }
        if (error.aborted) {
            return { title: "请求已取消", message: "你切换了页面或开启了新会话，本轮请求已停止。" };
        }
        if (error.status >= 500) {
            return { title: "服务端异常", message: "后端处理失败。常见原因包括数据库未初始化、模型服务异常或后端代码报错。" };
        }
        if (error.status >= 400) {
            return { title: "请求参数需要检查", message: "后端拒绝了本轮请求，请检查会话、用户 ID 或输入内容后重试。" };
        }
        return { title: "网络不可达", message: "没有连上后端服务。确认 IDEA 中应用已启动后再重试。" };
    }

    function errorDetailText(error, request) {
        const detail = {
            status: error && error.status ? error.status : undefined,
            backendMessage: error && error.backendMessage ? error.backendMessage : undefined,
            raw: error && error.raw ? error.raw : undefined,
            request
        };
        return safeJson(detail);
    }

    function scrollMessagesToBottom() {
        const messages = document.getElementById("messages");
        if (messages) {
            messages.scrollTop = messages.scrollHeight;
        }
    }

    function focusChatInput() {
        window.requestAnimationFrame(() => {
            const input = document.getElementById("chatMessage");
            if (input) {
                input.focus({ preventScroll: true });
            }
        });
    }

    async function submitChat(form) {
        const messageInput = form.elements.message;
        const message = messageInput.value.trim();
        if (!message || state.chat.sending) {
            return;
        }

        state.chat.draft = "";
        state.chat.messages.push({
            id: uid("user"),
            role: "user",
            kind: "text",
            text: message
        });

        const request = {
            message,
            sourceMode: state.chat.sourceMode,
            sessionId: state.chat.sessionId
        };
        const pending = pendingMessage(request);
        state.chat.messages.push(pending);
        state.chat.sending = true;
        renderChat({ focusInput: true });

        await performChatRequest(pending.id, request);
    }

    function pendingMessage(request, id) {
        return {
            id: id || uid("pending"),
            role: "assistant",
            kind: "pending",
            text: "正在理解你的需求...",
            request: { ...request }
        };
    }

    async function performChatRequest(messageId, request) {
        cancelChatRequest({ keepMessages: true });
        const controller = new AbortController();
        const requestId = ++state.chat.requestSeq;
        state.chat.activeRequest = { requestId, controller };
        state.chat.sending = true;

        try {
            let sessionId = request.sessionId || state.chat.sessionId;
            if (!sessionId) {
                const session = await DietApi.createSession({
                    signal: controller.signal,
                    context: { operation: "createSession", message: request.message, sourceMode: request.sourceMode }
                });
                if (!isActiveChatRequest(requestId)) {
                    return;
                }
                sessionId = session.sessionId;
                state.chat.sessionId = sessionId;
            }

            request.sessionId = sessionId;
            const payload = {
                sessionId,
                message: request.message,
                sourceMode: request.sourceMode,
                context: {}
            };
            const response = await DietApi.chat(payload, {
                signal: controller.signal,
                context: payload
            });

            if (!isActiveChatRequest(requestId)) {
                return;
            }

            state.chat.sessionId = response.sessionId || sessionId;
            replaceMessage(messageId, buildAssistantMessage(response));
        } catch (error) {
            if (!isActiveChatRequest(requestId)) {
                return;
            }
            if (error && error.aborted) {
                removeMessage(messageId);
                return;
            }
            replaceMessage(messageId, {
                id: messageId,
                role: "assistant",
                kind: "error",
                text: "",
                error,
                request: { ...request, sessionId: request.sessionId || state.chat.sessionId }
            });
        } finally {
            if (isActiveChatRequest(requestId)) {
                state.chat.sending = false;
                state.chat.activeRequest = null;
                renderChat({ focusInput: true });
            }
        }
    }

    function buildAssistantMessage(response) {
        const responseType = response.responseType || "ANSWER";
        const text = response.clarifyQuestion || response.speechText || "我已经处理完这轮请求。";
        return {
            id: uid("assistant"),
            role: "assistant",
            kind: responseType === "CLARIFY" ? "clarify" : "answer",
            text,
            responseType,
            meals: response.displayBlocks || [],
            missingSlots: response.missingSlots || [],
            traceId: response.traceId,
            sessionId: response.sessionId || state.chat.sessionId
        };
    }

    function isActiveChatRequest(requestId) {
        return state.chat.activeRequest && state.chat.activeRequest.requestId === requestId;
    }

    function replaceMessage(messageId, nextMessage) {
        const index = state.chat.messages.findIndex((message) => message.id === messageId);
        if (index >= 0) {
            state.chat.messages[index] = nextMessage;
        }
    }

    function removeMessage(messageId) {
        state.chat.messages = state.chat.messages.filter((message) => message.id !== messageId);
    }

    function cancelChatRequest(options) {
        const opts = options || {};
        if (state.chat.activeRequest) {
            state.chat.activeRequest.controller.abort();
            state.chat.activeRequest = null;
        }
        state.chat.sending = false;
        if (opts.removePending) {
            state.chat.messages = state.chat.messages.filter((message) => message.kind !== "pending");
        }
        if (!opts.keepMessages && currentRoute() === "/diet/chat") {
            renderChat();
        }
    }

    function resetChat(text) {
        cancelChatRequest({ removePending: true, keepMessages: true });
        state.chat.sessionId = null;
        state.chat.draft = "";
        state.chat.messages = [welcomeMessage(text || "已开启新会话。告诉我你的用餐时间、口味、场景或健康目标，我来推荐。")];
        renderChat({ focusInput: true });
    }

    function retryChat(messageId) {
        if (state.chat.sending) {
            return;
        }
        const index = state.chat.messages.findIndex((message) => message.id === messageId && message.kind === "error");
        if (index < 0) {
            return;
        }
        const request = {
            ...state.chat.messages[index].request,
            sessionId: state.chat.messages[index].request.sessionId || state.chat.sessionId
        };
        state.chat.messages[index] = pendingMessage(request, messageId);
        state.chat.sending = true;
        renderChat({ focusInput: true });
        performChatRequest(messageId, request);
    }

    function restoreChatDraft(messageId) {
        const message = state.chat.messages.find((item) => item.id === messageId && item.kind === "error");
        if (!message || !message.request) {
            return;
        }
        state.chat.draft = message.request.message || "";
        renderChat({ focusInput: true });
    }

    function renderPersonalMeals() {
        if (!state.slotOptions && !state.slotOptionsLoading && !state.slotOptionsError) {
            ensureSlotOptions().then(() => {
                if (currentRoute() === "/diet/meals/personal") {
                    renderPersonalMeals();
                }
            });
        }
        if (!state.personalMealsLoaded && !state.personalMealsLoading && !state.personalMealsError) {
            ensurePersonalMeals().then(() => {
                if (currentRoute() === "/diet/meals/personal") {
                    renderPersonalMeals();
                }
            });
        }

        app.innerHTML = `
            <section class="split">
                <div class="section">
                    <div class="page-title">
                        <div>
                            <p class="eyebrow">我的餐食</p>
                            <h1>维护个人餐食库</h1>
                            <p>按槽位标签维护常吃餐食，PERSONAL 模式会优先用这里的数据推荐。</p>
                        </div>
                        <button class="btn primary" type="button" data-action="new-meal">新增餐食</button>
                    </div>
                    <div id="personalMealList">${renderPersonalMealContent()}</div>
                </div>
                <aside class="section">
                    ${renderMealForm()}
                </aside>
            </section>
        `;
    }

    function renderPersonalMealContent() {
        if (state.personalMealsLoading) {
            return loadingBlock("个人餐食加载中...");
        }
        if (state.personalMealsError) {
            return inlineNotice(state.personalMealsError, "重新加载", "reload-personal-meals");
        }
        return renderMealList(state.personalMeals, { editable: true });
    }

    function renderMealForm() {
        if (state.slotOptionsError) {
            return inlineNotice(state.slotOptionsError, "重试标签加载", "reload-slot-options");
        }
        if (state.slotOptionsLoading || !state.slotOptions) {
            return loadingBlock("标签字典加载中...");
        }

        const meal = state.editingMeal || emptyMeal();
        const title = meal.id ? "编辑餐食" : "新增餐食";
        return `
            <div class="card-title">
                <div>
                    <h3>${title}</h3>
                    <p>用餐时间必选，其余标签越完整，推荐越容易解释。</p>
                </div>
            </div>
            <form id="mealForm" class="form-grid">
                <input type="hidden" name="mealId" value="${escapeHtml(meal.id || "")}">
                <div class="field full">
                    <label for="mealName">餐食名称</label>
                    <input id="mealName" name="name" value="${escapeHtml(meal.name || "")}" placeholder="例如：番茄鸡蛋面" required>
                </div>
                ${Object.entries(SLOT_LABELS).map(([key, label]) => renderSlotPicker(key, label, meal[key] || [])).join("")}
                <p class="field-hint full">多选标签可以直接点选。修改表单后切换餐食，会先提示是否丢弃未保存内容。</p>
                <div class="field full">
                    <div class="button-row">
                        <button class="btn primary" type="submit">${meal.id ? "保存修改" : "创建餐食"}</button>
                        <button class="btn ghost" type="button" data-action="cancel-edit">清空</button>
                    </div>
                </div>
            </form>
        `;
    }

    function renderSlotPicker(key, label, selected) {
        const options = state.slotOptions && state.slotOptions[key] ? state.slotOptions[key] : [];
        const selectedSet = new Set(selected || []);
        if (!options.length) {
            return `
                <div class="field full">
                    <span>${escapeHtml(label)}</span>
                    <div class="empty">暂无可选标签</div>
                </div>
            `;
        }
        return `
            <div class="field full slot-group">
                <span id="slot-${escapeHtml(key)}">${escapeHtml(label)}${key === "mealTime" ? "（必选）" : ""}</span>
                <div class="chips" role="group" aria-labelledby="slot-${escapeHtml(key)}">
                    ${options.map((option) => `
                        <label class="chip option-chip ${selectedSet.has(option) ? "selected" : ""}">
                            <input type="checkbox" name="${escapeHtml(key)}" value="${escapeHtml(option)}" ${selectedSet.has(option) ? "checked" : ""}>
                            <span>${escapeHtml(option)}</span>
                        </label>
                    `).join("")}
                </div>
            </div>
        `;
    }

    function emptyMeal() {
        return {
            name: "",
            mealTime: [],
            mood: [],
            scene: [],
            healthGoal: [],
            cuisine: [],
            taste: [],
            convenience: []
        };
    }

    function renderMealList(meals, options) {
        if (!meals.length) {
            return `
                <div class="empty">
                    <strong>暂无餐食</strong>
                    <span>可以先新增几道常吃的菜，后续推荐会更贴近你。</span>
                </div>
            `;
        }
        return `<div class="grid two">${meals.map((meal) => renderMealCard(meal, options || {})).join("")}</div>`;
    }

    function renderMealCard(meal, options) {
        const opts = options || {};
        const editable = opts.editable;
        const feedback = opts.feedback;
        const score = Number(meal.matchScore || 0);
        const hasScore = score > 0;
        return `
            <article class="meal-card">
                <header>
                    <div>
                        <h3>${escapeHtml(meal.name)}</h3>
                        <p class="muted small">${escapeHtml(sourceLabel(meal.sourceType))}</p>
                    </div>
                    ${hasScore ? `<span class="score">匹配 ${Math.round(score * 100)}%</span>` : ""}
                </header>
                ${opts.responseText ? `<p class="muted">${escapeHtml(opts.responseText)}</p>` : ""}
                <div class="chips">${mealTags(meal).map((tag) => `<span class="chip selected">${escapeHtml(tag)}</span>`).join("") || `<span class="chip">暂无标签</span>`}</div>
                ${editable ? `
                    <div class="button-row">
                        <button class="btn soft compact" type="button" data-action="edit-meal" data-id="${escapeHtml(meal.id)}">编辑</button>
                        <button class="btn ghost compact" type="button" data-action="delete-meal" data-id="${escapeHtml(meal.id)}">删除</button>
                    </div>
                ` : ""}
                ${feedback ? renderFeedbackControls(meal, opts.sessionId) : ""}
            </article>
        `;
    }

    function renderFeedbackControls(meal, sessionId) {
        const key = feedbackKey(sessionId, meal.id);
        const current = state.feedback[key] || {};
        const disabled = current.loading ? "disabled" : "";
        return `
            <div class="button-row">
                ${feedbackButton("LIKE", "有用", meal.id, sessionId, current, disabled)}
                ${feedbackButton("ADOPT", "采纳", meal.id, sessionId, current, disabled)}
                ${feedbackButton("DISLIKE", "不合适", meal.id, sessionId, current, disabled)}
            </div>
            <div class="feedback-state" aria-live="polite">
                ${feedbackText(current)}
            </div>
        `;
    }

    function feedbackButton(action, label, itemId, sessionId, current, disabled) {
        const active = current.action === action && current.status === "done";
        return `
            <button class="btn ${active ? "soft" : "ghost"} compact" type="button"
                    data-action="feedback" data-action-value="${action}"
                    data-item-id="${escapeHtml(itemId)}" data-session-id="${escapeHtml(sessionId || "")}"
                    ${disabled}>
                ${escapeHtml(label)}
            </button>
        `;
    }

    function feedbackText(current) {
        if (current.loading) {
            return "反馈提交中...";
        }
        if (current.status === "done") {
            return "反馈已记录";
        }
        if (current.status === "error") {
            return "反馈提交失败，可再次点击重试";
        }
        return "";
    }

    function feedbackKey(sessionId, itemId) {
        return `${sessionId || state.chat.sessionId || "session"}:${itemId}`;
    }

    function sourceLabel(sourceType) {
        if (sourceType === "PERSONAL") {
            return "个人库";
        }
        if (sourceType === "PUBLIC") {
            return "公共库";
        }
        return sourceType || "";
    }

    function mealTags(meal) {
        return Object.keys(SLOT_LABELS).flatMap((key) => (meal[key] || []).map((value) => `${SLOT_LABELS[key]}：${value}`));
    }

    async function ensurePersonalMeals(force) {
        if (!force && (state.personalMealsLoaded || state.personalMealsLoading)) {
            return;
        }
        state.personalMealsLoading = true;
        state.personalMealsError = "";
        try {
            state.personalMeals = await DietApi.listPersonalMeals();
            state.personalMealsLoaded = true;
            state.home.loaded = false;
        } catch (error) {
            state.personalMealsError = error.message || "个人餐食加载失败";
        } finally {
            state.personalMealsLoading = false;
        }
    }

    async function ensureSlotOptions(force) {
        if (!force && (state.slotOptions || state.slotOptionsLoading)) {
            return;
        }
        state.slotOptionsLoading = true;
        state.slotOptionsError = "";
        try {
            state.slotOptions = await DietApi.slotOptions();
        } catch (error) {
            state.slotOptionsError = error.message || "槽位字典加载失败";
        } finally {
            state.slotOptionsLoading = false;
        }
    }

    async function saveMeal(form) {
        const { id, payload } = mealPayloadFromForm(form);
        if (!payload.name) {
            showToast("请填写餐食名称", "error");
            return;
        }
        if (!payload.mealTime.length) {
            showToast("请至少选择一个用餐时间标签", "error");
            return;
        }
        const restore = setLoading(form.querySelector("button[type=submit]"), "保存中...");
        try {
            await guard(async () => {
                if (id) {
                    return DietApi.updatePersonalMeal(id, payload);
                }
                return DietApi.createPersonalMeal(payload);
            }, id ? "餐食已更新" : "餐食已创建");
            state.mealDirty = false;
            state.editingMeal = null;
            await ensurePersonalMeals(true);
            renderPersonalMeals();
        } finally {
            restore();
        }
    }

    function mealPayloadFromForm(form) {
        const formData = new FormData(form);
        const payload = {
            name: String(formData.get("name") || "").trim()
        };
        Object.keys(SLOT_LABELS).forEach((key) => {
            payload[key] = formData.getAll(key).filter(Boolean);
        });
        return {
            id: String(formData.get("mealId") || "").trim(),
            payload
        };
    }

    function confirmDiscardMealChanges() {
        if (!state.mealDirty) {
            return true;
        }
        return window.confirm("当前餐食表单有未保存内容，确定丢弃吗？");
    }

    function editMeal(id) {
        if (!confirmDiscardMealChanges()) {
            return;
        }
        const meal = state.personalMeals.find((item) => String(item.id) === String(id));
        if (!meal) {
            showToast("没有找到要编辑的餐食", "error");
            return;
        }
        state.editingMeal = JSON.parse(JSON.stringify(meal));
        state.mealDirty = false;
        renderPersonalMeals();
    }

    async function deleteMeal(id) {
        const meal = state.personalMeals.find((item) => String(item.id) === String(id));
        if (!meal || !window.confirm(`确定删除“${meal.name}”？`)) {
            return;
        }
        await guard(async () => {
            await DietApi.deletePersonalMeal(id);
            state.mealDirty = false;
            await ensurePersonalMeals(true);
            renderPersonalMeals();
        }, "餐食已删除");
    }

    function renderPublicMeals() {
        if (!state.publicMealsLoaded && !state.publicMealsLoading && !state.publicMealsError) {
            ensurePublicMeals().then(() => {
                if (currentRoute() === "/diet/meals/public") {
                    renderPublicMeals();
                }
            });
        }

        app.innerHTML = `
            <section class="section">
                <div class="page-title">
                    <div>
                        <p class="eyebrow">公共餐食</p>
                        <h1>查看公共餐食库</h1>
                        <p>公共库只读展示，可在聊天页切换到 PUBLIC 模式体验完整推荐链路。</p>
                    </div>
                    <a class="btn primary" href="#/diet/chat">去聊天推荐</a>
                </div>
                <form id="publicFilterForm" class="list-toolbar">
                    <label class="sr-only" for="publicMealQuery">筛选公共餐食</label>
                    <input id="publicMealQuery" class="search-input" name="query" value="${escapeHtml(state.publicFilter.query)}" placeholder="按餐食名称或标签筛选">
                    <div class="button-row">
                        <button class="btn soft compact" type="submit">筛选</button>
                        <button class="btn ghost compact" type="button" data-action="reset-public-filter">重置</button>
                    </div>
                </form>
                <div id="publicMealList">${renderPublicMealContent()}</div>
            </section>
        `;
    }

    function renderPublicMealContent() {
        if (state.publicMealsLoading) {
            return loadingBlock("公共餐食加载中...");
        }
        if (state.publicMealsError) {
            return inlineNotice(state.publicMealsError, "重新加载", "reload-public-meals");
        }
        const meals = filteredPublicMeals();
        if (!meals.length && state.publicFilter.query) {
            return `
                <div class="empty">
                    <strong>没有匹配的公共餐食</strong>
                    <span>可以换个关键词，或回到聊天页直接描述需求。</span>
                    <a class="btn soft" href="#/diet/chat">去聊天推荐</a>
                </div>
            `;
        }
        return `
            <p class="muted small" style="margin-top: 0;">共 ${meals.length} 条结果</p>
            ${renderMealList(meals, {})}
        `;
    }

    function filteredPublicMeals() {
        const query = state.publicFilter.query.trim().toLowerCase();
        if (!query) {
            return state.publicMeals;
        }
        return state.publicMeals.filter((meal) => {
            const haystack = [meal.name, ...mealTags(meal)].join(" ").toLowerCase();
            return haystack.includes(query);
        });
    }

    async function ensurePublicMeals(force) {
        if (!force && (state.publicMealsLoaded || state.publicMealsLoading)) {
            return;
        }
        state.publicMealsLoading = true;
        state.publicMealsError = "";
        try {
            state.publicMeals = await DietApi.listPublicMeals();
            state.publicMealsLoaded = true;
            state.home.loaded = false;
        } catch (error) {
            state.publicMealsError = error.message || "公共餐食加载失败";
        } finally {
            state.publicMealsLoading = false;
        }
    }

    function renderTraces() {
        const selected = state.traces.selected;
        app.innerHTML = `
            <section class="split wide-detail">
                <div class="section">
                    <div class="page-title">
                        <div>
                            <p class="eyebrow">研发工具</p>
                            <h1>Trace 排查</h1>
                            <p>按时间范围或会话查询请求链路，查看状态、耗时、事件和标注。</p>
                        </div>
                    </div>
                    <details open>
                        <summary>筛选条件</summary>
                        <form id="traceFilterForm" class="form-grid" style="margin-top: 16px;">
                            <div class="field">
                                <label for="traceStartAt">开始时间</label>
                                <input id="traceStartAt" type="datetime-local" name="startAt" value="${escapeHtml(state.traces.filters.startAt)}" required>
                            </div>
                            <div class="field">
                                <label for="traceEndAt">结束时间</label>
                                <input id="traceEndAt" type="datetime-local" name="endAt" value="${escapeHtml(state.traces.filters.endAt)}" required>
                            </div>
                            <div class="field">
                                <label for="traceSessionId">会话 ID（可选）</label>
                                <input id="traceSessionId" name="sessionId" value="${escapeHtml(state.traces.filters.sessionId)}" placeholder="填写后按会话查询">
                            </div>
                            <div class="field">
                                <label for="traceLimit">数量上限</label>
                                <input id="traceLimit" type="number" min="1" max="500" name="limit" value="${escapeHtml(state.traces.filters.limit)}">
                            </div>
                            <div class="field">
                                <label for="onlyUnlabeled">标注状态</label>
                                <select id="onlyUnlabeled" name="onlyUnlabeled">
                                    <option value="false" ${!state.traces.filters.onlyUnlabeled ? "selected" : ""}>全部</option>
                                    <option value="true" ${state.traces.filters.onlyUnlabeled ? "selected" : ""}>仅未标注</option>
                                </select>
                            </div>
                            <div class="field">
                                <span>&nbsp;</span>
                                <button class="btn primary" type="submit" ${state.traces.loading ? "disabled" : ""}>${state.traces.loading ? "查询中..." : "查询 Trace"}</button>
                            </div>
                        </form>
                    </details>
                    <div class="subtle-divider"></div>
                    ${state.traces.error ? inlineNotice(state.traces.error, "", "") : ""}
                    ${renderTraceTable()}
                </div>
                <aside class="section">
                    ${selected ? renderTraceDetail(selected) : `<div class="empty">选择一条 Trace 查看详情和标注表单。</div>`}
                </aside>
            </section>
        `;
    }

    function renderTraceTable() {
        if (state.traces.loading) {
            return loadingBlock("Trace 查询中...");
        }
        if (!state.traces.rows.length) {
            return `<div class="empty">暂无 Trace 数据。可以先在聊天页发起几轮对话。</div>`;
        }
        return `
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Trace ID</th>
                            <th>会话</th>
                            <th>状态</th>
                            <th>事件</th>
                            <th>耗时</th>
                            <th>创建时间</th>
                            <th>标注</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.traces.rows.map(renderTraceRow).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderTraceRow(row) {
        return `
            <tr>
                <td><code>${escapeHtml(row.traceId)}</code></td>
                <td>${escapeHtml(row.sessionId)}</td>
                <td>${statusBadge(row.status)}</td>
                <td>${escapeHtml(row.eventCount ?? "-")}</td>
                <td>${row.durationMs ? `${escapeHtml(row.durationMs)} ms` : "-"}</td>
                <td>${escapeHtml(row.createdAt || "-")}</td>
                <td>${row.expectedIntent ? `<span class="badge">${escapeHtml(row.expectedIntent)}</span>` : "<span class=\"muted\">未标注</span>"}</td>
                <td><button class="btn soft compact" type="button" data-action="select-trace" data-trace-id="${escapeHtml(row.traceId)}">查看</button></td>
            </tr>
        `;
    }

    function statusBadge(status) {
        const value = status || "UNKNOWN";
        let type = "warning";
        if (value === "SUCCESS") {
            type = "success";
        } else if (value === "FAILED" || value === "ERROR") {
            type = "error";
        }
        return `<span class="status-badge ${type}">${escapeHtml(value)}</span>`;
    }

    function renderTraceDetail(trace) {
        return `
            <div class="card-title">
                <div>
                    <h3>Trace 详情</h3>
                    <p><code>${escapeHtml(trace.traceId)}</code></p>
                </div>
                ${statusBadge(trace.status)}
            </div>
            <div class="grid">
                <p class="muted">Session：${escapeHtml(trace.sessionId || "-")} · Events：${escapeHtml(trace.eventCount ?? "-")} · Duration：${escapeHtml(trace.durationMs ?? "-")} ms</p>
                ${trace.errorMessage ? `<div class="inline-error"><strong>错误信息</strong><p>${escapeHtml(trace.errorMessage)}</p></div>` : ""}
                <details>
                    <summary>Trace JSON</summary>
                    <pre class="json-box">${escapeHtml(safeJson(trace.traceJson))}</pre>
                </details>
                <form id="traceLabelForm" class="form-grid">
                    <input type="hidden" name="traceId" value="${escapeHtml(trace.traceId)}">
                    <div class="field">
                        <label for="expectedIntent">预期意图</label>
                        <select id="expectedIntent" name="expectedIntent">
                            <option value="">不标注</option>
                            ${INTENTS.map((intent) => `<option value="${intent}" ${trace.expectedIntent === intent ? "selected" : ""}>${intent}</option>`).join("")}
                        </select>
                    </div>
                    <div class="field">
                        <label for="expectedClarifyAction">澄清动作</label>
                        <select id="expectedClarifyAction" name="expectedClarifyAction">
                            <option value="">不标注</option>
                            <option value="ASK" ${trace.expectedClarifyAction === "ASK" ? "selected" : ""}>ASK</option>
                            <option value="READY" ${trace.expectedClarifyAction === "READY" ? "selected" : ""}>READY</option>
                        </select>
                    </div>
                    <div class="field full">
                        <label for="expectedSlots">预期槽位 JSON</label>
                        <textarea id="expectedSlots" name="expectedSlots" placeholder='{"mealTime":["晚餐"],"taste":["清淡"]}'>${escapeHtml(safeJson(trace.expectedSlots))}</textarea>
                    </div>
                    <div class="field full">
                        <label for="labelNote">备注</label>
                        <textarea id="labelNote" name="labelNote" placeholder="标注说明">${escapeHtml(trace.labelNote || "")}</textarea>
                    </div>
                    <div class="field full">
                        <button class="btn primary" type="submit">保存标注</button>
                    </div>
                </form>
            </div>
        `;
    }

    async function searchTraces(form) {
        const formData = new FormData(form);
        state.traces.filters = {
            startAt: formData.get("startAt"),
            endAt: formData.get("endAt"),
            sessionId: String(formData.get("sessionId") || "").trim(),
            onlyUnlabeled: formData.get("onlyUnlabeled") === "true",
            limit: Number(formData.get("limit") || 50)
        };
        state.traces.loading = true;
        state.traces.error = "";
        renderTraces();
        try {
            if (state.traces.filters.sessionId) {
                state.traces.rows = await DietApi.listSessionTraces(state.traces.filters.sessionId, state.traces.filters.limit);
            } else {
                state.traces.rows = await DietApi.listTraces({
                    startAt: state.traces.filters.startAt,
                    endAt: state.traces.filters.endAt,
                    onlyUnlabeled: state.traces.filters.onlyUnlabeled,
                    limit: state.traces.filters.limit
                });
            }
            state.traces.selected = state.traces.rows[0] || null;
        } catch (error) {
            state.traces.error = error.message || "Trace 查询失败";
        } finally {
            state.traces.loading = false;
            renderTraces();
        }
    }

    async function selectTrace(traceId) {
        await guard(async () => {
            state.traces.selected = await DietApi.getTrace(traceId);
            renderTraces();
        });
    }

    async function saveTraceLabel(form) {
        const formData = new FormData(form);
        const traceId = formData.get("traceId");
        const slotsText = String(formData.get("expectedSlots") || "").trim();
        let expectedSlots = null;
        if (slotsText) {
            try {
                expectedSlots = JSON.parse(slotsText);
            } catch (error) {
                showToast("预期槽位必须是合法 JSON", "error");
                return;
            }
        }
        const payload = {
            expectedIntent: formData.get("expectedIntent") || null,
            expectedSlots,
            expectedClarifyAction: formData.get("expectedClarifyAction") || null,
            labelNote: String(formData.get("labelNote") || "").trim()
        };
        await guard(async () => {
            await DietApi.labelTrace(traceId, payload);
            state.traces.selected = await DietApi.getTrace(traceId);
            const index = state.traces.rows.findIndex((row) => row.traceId === traceId);
            if (index >= 0) {
                state.traces.rows[index] = state.traces.selected;
            }
            renderTraces();
        }, "Trace 标注已保存");
    }

    function renderEvaluations() {
        app.innerHTML = `
            <section class="section">
                <div class="page-title">
                    <div>
                        <p class="eyebrow">研发工具</p>
                        <h1>批量评估</h1>
                        <p>基于已落库 Trace 生成规则评分、可选 LLM Judge 和反馈归因指标。</p>
                    </div>
                </div>
                <form id="evaluationForm" class="form-grid">
                    <div class="field">
                        <label for="evalStartAt">开始时间</label>
                        <input id="evalStartAt" type="datetime-local" name="startAt" value="${escapeHtml(state.evaluation.form.startAt)}" required>
                    </div>
                    <div class="field">
                        <label for="evalEndAt">结束时间</label>
                        <input id="evalEndAt" type="datetime-local" name="endAt" value="${escapeHtml(state.evaluation.form.endAt)}" required>
                    </div>
                    <div class="field">
                        <label for="evalLimit">数量上限</label>
                        <input id="evalLimit" type="number" min="1" max="500" name="limit" value="${escapeHtml(state.evaluation.form.limit)}">
                    </div>
                    <div class="field">
                        <label for="includeLlmJudge">LLM Judge</label>
                        <select id="includeLlmJudge" name="includeLlmJudge">
                            <option value="false" ${!state.evaluation.form.includeLlmJudge ? "selected" : ""}>关闭</option>
                            <option value="true" ${state.evaluation.form.includeLlmJudge ? "selected" : ""}>开启</option>
                        </select>
                    </div>
                    <div class="field full">
                        <button class="btn primary" type="submit" ${state.evaluation.loading ? "disabled" : ""}>${state.evaluation.loading ? "评估中..." : "生成评估报告"}</button>
                    </div>
                </form>
            </section>
            <section class="section" style="margin-top: 24px;">
                ${renderEvaluationReport()}
            </section>
        `;
    }

    function renderEvaluationReport() {
        const report = state.evaluation.report;
        if (state.evaluation.loading) {
            return loadingBlock("正在生成评估报告。当前后端没有进度接口，因此只展示等待状态。");
        }
        if (state.evaluation.error) {
            return inlineNotice(state.evaluation.error, "", "");
        }
        if (!report) {
            return `<div class="empty">暂无报告。选择时间范围后生成评估。</div>`;
        }
        return `
            <div class="grid three">
                ${metricCard("Trace 总数", report.totalTraces, "本次纳入评估的请求数")}
                ${metricCard("已标注", report.labeledTraces, "有人工标签的 Trace 数")}
                ${metricCard("平均分", formatScore(report.avgScore), "综合评分，越高说明链路越稳定")}
            </div>
            <div class="subtle-divider"></div>
            <div class="grid two">
                <div>
                    <h3>指标均值</h3>
                    ${renderMetrics(report.metricAverages)}
                </div>
                <div>
                    <h3>报告范围</h3>
                    <p class="muted">${escapeHtml(report.startAt)} 至 ${escapeHtml(report.endAt)}</p>
                </div>
            </div>
            <div class="subtle-divider"></div>
            ${renderEvaluationTable(report.traceResults || [])}
        `;
    }

    function metricCard(label, value, desc) {
        return `
            <article class="metric-card">
                <span class="muted">${escapeHtml(label)}</span>
                <strong>${escapeHtml(value)}</strong>
                <p class="muted small">${escapeHtml(desc)}</p>
            </article>
        `;
    }

    function renderMetrics(metrics) {
        const entries = Object.entries(metrics || {});
        if (!entries.length) {
            return `<div class="empty">暂无指标</div>`;
        }
        return `
            <div class="chips">
                ${entries.map(([key, value]) => `<span class="chip selected">${escapeHtml(METRIC_LABELS[key] || key)}：${formatScore(value)}</span>`).join("")}
            </div>
        `;
    }

    function renderEvaluationTable(rows) {
        if (!rows.length) {
            return `<div class="empty">暂无 Trace 明细</div>`;
        }
        return `
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Trace ID</th>
                            <th>会话</th>
                            <th>综合分</th>
                            <th>规则分</th>
                            <th>LLM 分</th>
                            <th>反馈分</th>
                            <th>指标 / 明细</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map((row) => `
                            <tr>
                                <td><code>${escapeHtml(row.traceId)}</code></td>
                                <td>${escapeHtml(row.sessionId)}</td>
                                <td>${formatScore(row.score)}</td>
                                <td>${formatScore(row.ruleScore)}</td>
                                <td>${formatScore(row.llmJudgeScore)}</td>
                                <td>${formatScore(row.userFeedbackScore)}</td>
                                <td>
                                    <details>
                                        <summary>查看 JSON</summary>
                                        <pre class="json-box">${escapeHtml(JSON.stringify({ metrics: row.metrics, detail: row.detail }, null, 2))}</pre>
                                    </details>
                                </td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    function formatScore(value) {
        return value === null || value === undefined || value === "" ? "-" : Number(value).toFixed(2);
    }

    async function runEvaluation(form) {
        const formData = new FormData(form);
        state.evaluation.form = {
            startAt: formData.get("startAt"),
            endAt: formData.get("endAt"),
            limit: Number(formData.get("limit") || 50),
            includeLlmJudge: formData.get("includeLlmJudge") === "true"
        };
        state.evaluation.loading = true;
        state.evaluation.error = "";
        renderEvaluations();
        try {
            state.evaluation.report = await DietApi.evaluate(state.evaluation.form);
        } catch (error) {
            state.evaluation.error = error.message || "评估失败";
        } finally {
            state.evaluation.loading = false;
            renderEvaluations();
        }
    }

    async function saveFeedback(button) {
        const itemId = button.dataset.itemId;
        const sessionId = button.dataset.sessionId || state.chat.sessionId;
        const action = button.dataset.actionValue;
        const key = feedbackKey(sessionId, itemId);

        state.feedback[key] = { action, loading: true };
        renderChat();
        try {
            await DietApi.saveFeedback({
                sessionId,
                itemId: Number(itemId),
                action,
                rating: action === "DISLIKE" ? 2 : 5,
                reason: ""
            });
            state.feedback[key] = { action, status: "done" };
            showToast("反馈已记录");
        } catch (error) {
            state.feedback[key] = { action, status: "error" };
        } finally {
            if (currentRoute() === "/diet/chat") {
                renderChat();
            }
        }
    }

    function loadingBlock(text) {
        return `<div class="empty"><span>${escapeHtml(text)}</span></div>`;
    }

    function inlineNotice(message, label, action) {
        return `
            <div class="notice">
                <p>${escapeHtml(message)}</p>
                ${label && action ? `<button class="btn ghost compact" type="button" data-action="${escapeHtml(action)}">${escapeHtml(label)}</button>` : ""}
            </div>
        `;
    }

    function handleClick(event) {
        const target = event.target.closest("[data-action]");
        if (!target) {
            return;
        }
        const action = target.dataset.action;
        if (action === "set-source") {
            if (state.chat.sourceMode !== target.dataset.source) {
                state.chat.sourceMode = target.dataset.source;
                resetChat(`已切换到${state.chat.sourceMode === "PERSONAL" ? "个人库" : "公共库"}。告诉我这顿饭的时间、口味或目标，我来推荐。`);
            }
        } else if (action === "new-session") {
            resetChat();
        } else if (action === "quick-message") {
            state.chat.draft = target.dataset.message || "";
            renderChat({ focusInput: true });
        } else if (action === "retry-chat") {
            retryChat(target.dataset.messageId);
        } else if (action === "restore-chat") {
            restoreChatDraft(target.dataset.messageId);
        } else if (action === "feedback") {
            saveFeedback(target);
        } else if (action === "new-meal") {
            if (confirmDiscardMealChanges()) {
                state.editingMeal = emptyMeal();
                state.mealDirty = false;
                renderPersonalMeals();
            }
        } else if (action === "edit-meal") {
            editMeal(target.dataset.id);
        } else if (action === "delete-meal") {
            deleteMeal(target.dataset.id);
        } else if (action === "cancel-edit") {
            if (confirmDiscardMealChanges()) {
                state.editingMeal = null;
                state.mealDirty = false;
                renderPersonalMeals();
            }
        } else if (action === "reload-personal-meals") {
            state.personalMealsError = "";
            ensurePersonalMeals(true).then(renderPersonalMeals);
        } else if (action === "reload-public-meals") {
            state.publicMealsError = "";
            ensurePublicMeals(true).then(renderPublicMeals);
        } else if (action === "reload-slot-options") {
            state.slotOptionsError = "";
            ensureSlotOptions(true).then(renderPersonalMeals);
        } else if (action === "reset-public-filter") {
            state.publicFilter.query = "";
            renderPublicMeals();
        } else if (action === "select-trace") {
            selectTrace(target.dataset.traceId);
        } else if (action === "open-trace") {
            state.traces.filters.sessionId = "";
            navigate("/admin/traces");
            selectTrace(target.dataset.traceId);
        }
    }

    function handleInput(event) {
        const form = event.target.closest("form");
        if (!form) {
            return;
        }
        if (form.id === "chatForm") {
            state.chat.draft = form.elements.message.value;
        } else if (form.id === "mealForm") {
            state.mealDirty = true;
            const chip = event.target.closest(".option-chip");
            if (chip && event.target.type === "checkbox") {
                chip.classList.toggle("selected", event.target.checked);
            }
        }
    }

    function handleSubmit(event) {
        const form = event.target;
        if (form.id === "chatForm") {
            event.preventDefault();
            submitChat(form);
        } else if (form.id === "mealForm") {
            event.preventDefault();
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
            saveMeal(form);
        } else if (form.id === "publicFilterForm") {
            event.preventDefault();
            const formData = new FormData(form);
            state.publicFilter.query = String(formData.get("query") || "");
            const list = document.getElementById("publicMealList");
            if (list) {
                list.innerHTML = renderPublicMealContent();
            }
        } else if (form.id === "traceFilterForm") {
            event.preventDefault();
            searchTraces(form);
        } else if (form.id === "traceLabelForm") {
            event.preventDefault();
            saveTraceLabel(form);
        } else if (form.id === "evaluationForm") {
            event.preventDefault();
            runEvaluation(form);
        }
    }

    function handleDocumentClick(event) {
        const chromeTarget = event.target.closest("[data-chrome-action]");
        if (chromeTarget) {
            handleChromeAction(chromeTarget.dataset.chromeAction);
            return;
        }

        const link = event.target.closest("a[href^='#/']");
        if (link && currentRoute() === "/diet/meals/personal" && !confirmDiscardMealChanges()) {
            event.preventDefault();
            return;
        }

        if (!event.target.closest(".menu-root")) {
            closeChrome();
        }
    }

    function handleChromeAction(action) {
        if (action === "toggle-menu") {
            setNavOpen(!state.ui.navOpen);
            setToolsOpen(false);
            setSettingsOpen(false);
        } else if (action === "toggle-tools") {
            setToolsOpen(!state.ui.toolsOpen);
            setSettingsOpen(false);
        } else if (action === "toggle-settings") {
            setSettingsOpen(!state.ui.settingsOpen);
            setToolsOpen(false);
        }
    }

    function handleKeydown(event) {
        if (event.key === "Escape") {
            closeChrome();
        }
    }

    function closeChrome() {
        setNavOpen(false);
        setToolsOpen(false);
        setSettingsOpen(false);
    }

    function setNavOpen(open) {
        state.ui.navOpen = open;
        document.body.classList.toggle("nav-open", open);
        if (menuToggle) {
            menuToggle.setAttribute("aria-expanded", String(open));
        }
    }

    function setToolsOpen(open) {
        state.ui.toolsOpen = open;
        if (toolsButton) {
            toolsButton.setAttribute("aria-expanded", String(open));
        }
        if (toolsMenu) {
            toolsMenu.classList.toggle("hidden", !open);
        }
    }

    function setSettingsOpen(open) {
        state.ui.settingsOpen = open;
        if (settingsButton) {
            settingsButton.setAttribute("aria-expanded", String(open));
        }
        if (settingsPanel) {
            settingsPanel.classList.toggle("hidden", !open);
        }
    }

    function applyUserId(userId) {
        const normalized = DietApi.setUserId(userId);
        updateUserLabel();
        state.home.loaded = false;
        state.home.error = "";
        state.personalMeals = [];
        state.personalMealsLoaded = false;
        state.personalMealsError = "";
        state.publicMeals = [];
        state.publicMealsLoaded = false;
        state.publicMealsError = "";
        state.traces.rows = [];
        state.traces.selected = null;
        state.chat.sourceMode = "PERSONAL";
        resetChat("用户已切换。可以重新开始一轮推荐。");
        showToast(`用户 ID 已切换为 ${normalized}`);
        render();
    }

    function updateUserLabel() {
        const userId = DietApi.setUserId(DietApi.getUserId());
        if (userIdInput) {
            userIdInput.value = userId;
        }
        if (currentUserId) {
            currentUserId.textContent = userId;
        }
    }

    function initUserField() {
        updateUserLabel();
        if (settingsForm) {
            settingsForm.addEventListener("submit", (event) => {
                event.preventDefault();
                applyUserId(userIdInput.value);
                setSettingsOpen(false);
            });
        }
    }

    window.addEventListener("hashchange", render);
    window.addEventListener("beforeunload", (event) => {
        if (state.mealDirty) {
            event.preventDefault();
            event.returnValue = "";
        }
    });
    document.addEventListener("click", handleDocumentClick);
    document.addEventListener("keydown", handleKeydown);
    app.addEventListener("click", handleClick);
    app.addEventListener("input", handleInput);
    app.addEventListener("submit", handleSubmit);

    initUserField();
    if (!location.hash) {
        navigate("/diet");
    } else {
        render();
    }
})();
