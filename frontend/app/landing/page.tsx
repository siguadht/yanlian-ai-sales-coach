"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from "react";
import {
  ArrowRight, AudioLines, BarChart3, Check,
  Mic, PhoneCall, Play, ShieldCheck, Sparkles,
} from "lucide-react";
import { AiCustomerAvatar } from "@/components/AiCustomerAvatar";
import { Brand } from "@/components/Brand";
import styles from "./landing.module.css";

type DemoRole = "sales" | "customer";
type DemoPhase = "idle" | "listening" | "thinking" | "speaking" | "review";

const objections = ["我再考虑一下", "你们价格太高了", "现在没时间", "先把方案发我", "别家更便宜", "我需要和家人商量"];
const headlineWords = ["真实异议", "临场表达", "成交推进"];
const salesPrompts = ["先报最低价", "我为什么要相信你", "能不能保证效果", "我还要再对比"];
const customerPrompts = ["我只看价格", "你说得太专业了", "我现在不着急", "先发资料给我"];

const flows = [
  { index: "01", title: "选一个真实场景", text: "从行业、客户类型到刁难程度，把训练放进销售每天都会遇到的情境。", icon: PhoneCall },
  { index: "02", title: "像打电话一样开口", text: "连续语音或安静打字都可以。AI 会接话、追问，也会保留对话上下文。", icon: Mic },
  { index: "03", title: "结束后看懂问题", text: "销售角色获得评分与改进建议；客户角色查看 AI 销售的示范拆解。", icon: BarChart3 },
];

const scenes = [
  { label: "装修 · 电销获客", title: "把陌生电话，练成下一次见面", text: "练习建立联系、探查装修需求，并争取预约到店或量房。", number: "01" },
  { label: "装修 · 设计师逼单", title: "报价之后，继续推进真实决策", text: "围绕方案、报价、签约顾虑，把“再考虑”拆成可以回应的问题。", number: "02" },
  { label: "教育 / 保险", title: "面对顾虑，不急着背标准答案", text: "在课程报名与保障需求中，练习提问、澄清和下一步推进。", number: "03" },
];

export default function LandingPage() {
  const [role, setRole] = useState<DemoRole>("sales");
  const [headlineIndex, setHeadlineIndex] = useState(0);
  const [heroRole, setHeroRole] = useState<DemoRole>("sales");
  const [heroChoice, setHeroChoice] = useState(salesPrompts[0]);
  const [demoPhase, setDemoPhase] = useState<DemoPhase>("idle");
  const demoTimers = useRef<number[]>([]);
  const sales = role === "sales";
  const heroOptions = heroRole === "sales" ? salesPrompts : customerPrompts;
  const heroReply = heroRole === "sales"
    ? "我先不急着证明。您说不信任，最担心的是最终效果，还是过程不透明？"
    : "可以先谈价格。但在报价前，我想确认：您更怕预算超出，还是花了钱却没解决问题？";
  const orbState = demoPhase === "thinking" ? "thinking" : demoPhase === "speaking" ? "speaking" : demoPhase === "listening" ? "listening" : "idle";

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setHeadlineIndex((index) => (index + 1) % headlineWords.length), 2600);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => demoTimers.current.forEach(window.clearTimeout), []);

  const clearDemo = () => {
    demoTimers.current.forEach(window.clearTimeout);
    demoTimers.current = [];
    setDemoPhase("idle");
  };

  const chooseHeroPrompt = (choice: string) => {
    clearDemo();
    setHeroChoice(choice);
  };

  const switchHeroRole = (nextRole: DemoRole) => {
    clearDemo();
    setHeroRole(nextRole);
    setHeroChoice(nextRole === "sales" ? salesPrompts[0] : customerPrompts[0]);
  };

  const runDemo = () => {
    clearDemo();
    setDemoPhase("listening");
    demoTimers.current = [
      window.setTimeout(() => setDemoPhase("thinking"), 850),
      window.setTimeout(() => setDemoPhase("speaking"), 1750),
      window.setTimeout(() => setDemoPhase("review"), 3100),
    ];
  };

  const dropPrompt = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const choice = event.dataTransfer.getData("text/plain");
    if (heroOptions.includes(choice)) chooseHeroPrompt(choice);
  };

  const moveHeroLight = (event: PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mx", `${((event.clientX - bounds.left) / bounds.width) * 100}%`);
    event.currentTarget.style.setProperty("--my", `${((event.clientY - bounds.top) / bounds.height) * 100}%`);
  };

  return <main id="top" className={styles.page}>
    <header className={styles.nav}>
      <Link className={styles.brandLink} href="/landing" aria-label="言练宣传页"><Brand /></Link>
      <nav aria-label="宣传页导航">
        <a href="#how">怎么练</a>
        <a href="#roles">双角色</a>
        <a href="#scenes">适用场景</a>
        <a href="#privacy">数据边界</a>
      </nav>
      <Link className={styles.navCta} href="/">进入体验 <ArrowRight size={15} /></Link>
    </header>

    <section className={styles.playHero} onPointerMove={moveHeroLight}>
      <div className={styles.heroField} aria-hidden="true">
        <span className={styles.auroraOne} />
        <span className={styles.auroraTwo} />
        <span className={styles.auroraThree} />
        <span className={styles.signalOrbit} />
        <span className={styles.signalOrbitTwo} />
        <span className={styles.heroScan} />
      </div>
      <div className={styles.playHeroCopy}>
        <div className={styles.eyebrow}><span /> YANLI · AI SALES PRACTICE</div>
        <h1>把<br /><span key={headlineWords[headlineIndex]} className={styles.rotatingWord}>{headlineWords[headlineIndex]}</span><br />练成下意识。</h1>
        <p>言练把销售新人最容易卡住的真实对话，变成可以反复开口、即时复盘的 AI 陪练。</p>
        <div className={styles.heroActions}>
          <a className={styles.primaryCta} href="#playground">先玩一轮 <Play size={15} fill="currentColor" /></a>
          <Link className={styles.textCta} href="/">进入完整体验 <ArrowRight size={15} /></Link>
        </div>
        <div className={styles.heroFacts}>
          <span><strong>2</strong> 种角色</span>
          <span><strong>3</strong> 类行业</span>
          <span><strong>0</strong> 原始录音留存</span>
        </div>
      </div>

      <div id="playground" className={styles.playground} aria-label="可操作的言练产品演示">
        <div className={styles.playgroundBar}>
          <span><i /> PRODUCT PLAYGROUND</span>
          <span>交互示意 · 不调用模型</span>
        </div>
        <div className={styles.playgroundBody}>
          <div className={styles.playgroundRole} role="group" aria-label="选择体验角色">
            <button className={heroRole === "sales" ? styles.active : ""} aria-pressed={heroRole === "sales"} onClick={() => switchHeroRole("sales")}>我扮销售</button>
            <button className={heroRole === "customer" ? styles.active : ""} aria-pressed={heroRole === "customer"} onClick={() => switchHeroRole("customer")}>我扮客户</button>
          </div>

          <div className={styles.promptShelf}>
            <div><span>挑一句来练</span><small>点击，或拖进对话区</small></div>
            <div className={styles.promptOptions}>
              {heroOptions.map((item) => <button
                key={item}
                draggable
                className={heroChoice === item ? styles.chosen : ""}
                onClick={() => chooseHeroPrompt(item)}
                onDragStart={(event) => event.dataTransfer.setData("text/plain", item)}
              >{item}</button>)}
            </div>
          </div>

          <div className={styles.playgroundStage} onDragOver={(event) => event.preventDefault()} onDrop={dropPrompt}>
            <div className={styles.stageNoise} />
            <div className={styles.playOrb}>
              <span /><span />
              <AiCustomerAvatar state={orbState} featured tone="light" followPointer={false} />
            </div>
            <div className={styles.liveStatus} data-phase={demoPhase}>
              <AudioLines size={15} />
              <span>{demoPhase === "idle" ? "准备开始" : demoPhase === "listening" ? "正在听你说" : demoPhase === "thinking" ? "正在理解顾虑" : demoPhase === "speaking" ? "AI 正在回应" : "本轮复盘完成"}</span>
            </div>
            <div className={styles.customerLine}><span>{heroRole === "sales" ? "AI 客户" : "你 · 客户"}</span>“{heroChoice}。”</div>
            {(demoPhase === "speaking" || demoPhase === "review") && <div className={styles.replyLine}><span>{heroRole === "sales" ? "你可以这样问" : "AI 销售"}</span>{heroReply}</div>}
            {demoPhase === "review" && <div className={styles.miniReview}><Sparkles size={14} /><span><b>不是急着回答</b>先把笼统拒绝拆成一个可回答的问题。</span></div>}
          </div>

          <button className={styles.demoButton} onClick={runDemo} disabled={demoPhase !== "idle" && demoPhase !== "review"}>
            {demoPhase === "idle" || demoPhase === "review" ? <><Play size={14} fill="currentColor" />演示这一轮</> : <><span className={styles.buttonPulse} />演示进行中</>}
          </button>
          <div className={styles.playgroundFoot}><span><ShieldCheck size={13} />只保存文字</span><span><Mic size={13} />完整体验支持连续语音</span></div>
        </div>
      </div>
    </section>

    <div className={styles.objectionRail} aria-label="常见销售异议">
      <div>{[...objections, ...objections].map((item, index) => <span key={`${item}-${index}`}><i />{item}</span>)}</div>
    </div>

    <section className={styles.statement} id="how">
      <span className={styles.sectionIndex}>01 / HOW IT WORKS</span>
      <div>
        <h2>不是再听一遍课。<br />是把每句话真正说出口。</h2>
        <p>新人缺的通常不是更多知识，而是在压力下组织语言的肌肉记忆。言练把一次训练压缩成三个清楚的动作。</p>
      </div>
    </section>

    <section className={styles.flowGrid}>
      {flows.map(({ index, title, text, icon: Icon }) => <article key={index} className={styles.flowCard}>
        <div className={styles.flowMeta}><span>{index}</span><Icon size={20} strokeWidth={1.5} /></div>
        <h3>{title}</h3>
        <p>{text}</p>
        <div className={styles.flowLine}><i /></div>
      </article>)}
    </section>

    <section className={styles.roleSection} id="roles">
      <div className={styles.roleIntro}>
        <span className={styles.sectionIndex}>02 / TWO-SIDED PRACTICE</span>
        <h2>同一场对话，<br />换个位置再看一次。</h2>
        <p>既练“我会不会说”，也看“高手会怎么说”。两种角色解决的是不同的学习问题。</p>
        <div className={styles.roleTabs} role="group" aria-label="切换演示角色">
          <button className={sales ? styles.selected : ""} aria-pressed={sales} onClick={() => setRole("sales")}>我扮销售</button>
          <button className={!sales ? styles.selected : ""} aria-pressed={!sales} onClick={() => setRole("customer")}>我扮客户</button>
        </div>
      </div>

      <div className={styles.demoCard}>
        <div className={styles.demoHeader}>
          <div><span className={styles.demoDot} /><b>{sales ? "AI · 挑剔客户" : "AI · 销售示范"}</b></div>
          <span>{sales ? "难缠模式" : "示范模式"}</span>
        </div>
        <div className={styles.demoConversation}>
          <div className={styles.demoOrb}><AiCustomerAvatar state="idle" /></div>
          <div className={styles.demoBubble}>
            <span>{sales ? "AI 客户" : "您 · 客户"}</span>
            <p>{sales ? "你们方案看着都差不多，为什么要多花这笔钱？" : "你先把最低价告诉我，合适我再去店里。"}</p>
          </div>
          <div className={`${styles.demoBubble} ${styles.demoAnswer}`}>
            <span>{sales ? "您 · 销售" : "AI · 销售"}</span>
            <p>{sales ? "我先不急着谈价格，想确认一下，您最担心的是预算超出，还是最后效果不符合预期？" : "可以先谈价格，但我更想帮您避免只比一个数字。您方便说说面积和目前最在意的问题吗？"}</p>
          </div>
        </div>
        <div className={styles.demoReview}>
          <span><Sparkles size={15} />{sales ? "结束后获得评分与改进建议" : "结束后查看示范拆解，不给您打分"}</span>
          <b>{sales ? "先澄清顾虑，再解释价值" : "先接住问题，再把对话带回需求"}</b>
        </div>
      </div>
    </section>

    <section className={styles.sceneSection} id="scenes">
      <div className={styles.sceneHeading}>
        <span className={styles.sectionIndex}>03 / REAL SCENARIOS</span>
        <h2>练的不是万能话术，<br />是下一通真实电话。</h2>
      </div>
      <div className={styles.sceneList}>
        {scenes.map((scene) => <article key={scene.number}>
          <span className={styles.sceneNumber}>{scene.number}</span>
          <div><span>{scene.label}</span><h3>{scene.title}</h3></div>
          <p>{scene.text}</p>
          <ArrowRight size={20} />
        </article>)}
      </div>
    </section>

    <section className={styles.privacySection} id="privacy">
      <div className={styles.privacyVisual}>
        <span className={styles.privacyOrbit} />
        <ShieldCheck size={54} strokeWidth={1.15} />
        <span>VOICE IN</span><i />
        <span>TEXT OUT</span>
      </div>
      <div className={styles.privacyCopy}>
        <span className={styles.sectionIndex}>04 / DATA BOUNDARY</span>
        <h2>留下成长记录，<br />不留下原始录音。</h2>
        <p>语音实时转成文字后用于对话与复盘；练习结束保留文字和结果，原始音频不落盘。</p>
        <ul>
          <li><Check size={15} />每位体验者的记录独立保存</li>
          <li><Check size={15} />登录与权限判断在后端完成</li>
          <li><Check size={15} />模型密钥不会进入浏览器</li>
        </ul>
      </div>
    </section>

    <section className={styles.finalCta}>
      <div className={styles.finalOrb}><AiCustomerAvatar state="listening" featured /></div>
      <span>READY WHEN YOU ARE</span>
      <h2>下一次开口之前，<br />先在这里练一次。</h2>
      <p>选一个角色，进入一段真实销售对话。</p>
      <Link href="/">开始陪练 <ArrowRight size={19} /></Link>
    </section>

    <footer className={styles.footer}>
      <Brand />
      <div><span>双角色 AI 销售陪练</span><span>只保存文字，不保存原始录音</span></div>
      <a href="#top" aria-label="返回顶部">回到顶部 ↑</a>
    </footer>
  </main>;
}
