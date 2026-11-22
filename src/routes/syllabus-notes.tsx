import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef, useMemo, type UIEvent as ReactUIEvent } from "react";
import {
  BookOpen,
  ChevronRight,
  Search,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Volume2,
  Loader2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  HelpCircle,
  Trophy,
  ChevronDown,
  Lightbulb,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Layers,
  RotateCw,
  RotateCcw,
  Sparkles,
  Menu,
  Bot,
  SquarePen,
  Trash2,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  FileText,
  Calendar,
  GraduationCap,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard-page";
import {
  playRealisticVoice,
  stopRealisticVoice,
  pauseRealisticVoice,
  resumeRealisticVoice,
  preloadGeminiSpeech,
  cleanSpeechText,
  unlockAudio,
} from "@/lib/gemini-tts";
import type { SubjectNotes, Chapter, BulletGroup, SubHeading } from "@/lib/notes/types";
import {
  SYLLABUS_NOTES,
  convertChapterToFlashcards,
  type FlashcardItem,
} from "@/lib/syllabus-notes";
import { formatMathAndMarkdown } from "@/lib/render-math";
import { getChapterDiagramSvg } from "@/lib/diagrams";
import { STUDY_ARTICLES, type Article } from "@/lib/articles-data";
import { sound } from "@/components/arcade/sound-fx";

// Which subject row is expanded and which chapter is being read live in the URL,
// so a refresh anywhere lands back on the same screen.
type NotesSearch = {
  subject?: string;
  chapter?: number;
  view?: string;
  board?: string;
  article?: string;
};

export const Route = createFileRoute("/syllabus-notes")({
  validateSearch: (raw: Record<string, unknown>): NotesSearch => {
    const next: NotesSearch = {};
    if (typeof raw["subject"] === "string" && raw["subject"]) next.subject = raw["subject"];
    const chapter = Number(raw["chapter"]);
    if (Number.isInteger(chapter) && chapter > 0) next.chapter = chapter;
    if (typeof raw["view"] === "string" && raw["view"]) next.view = raw["view"];
    if (typeof raw["board"] === "string" && raw["board"]) next.board = raw["board"];
    if (typeof raw["article"] === "string" && raw["article"]) next.article = raw["article"];
    return next;
  },
  head: () => ({
    meta: [
      { title: "Courses & Revision Notes | ExamGlow" },
      {
        name: "description",
        content:
          "Structured, high-yield chapter revision notes for every IGCSE subject with interactive diagrams, voice masterclasses, and active recall checkpoints.",
      },
    ],
  }),
  component: SyllabusNotesPage,
});

// ─── Dot colours per category ─────────────────────────────────────────────────

const catDot: Record<string, string> = {
  Sciences: "bg-emerald-500",
  Mathematics: "bg-blue-500",
  "English & Literature": "bg-violet-500",
  Languages: "bg-pink-500",
  "Business & Economics": "bg-amber-500",
  Humanities: "bg-orange-500",
  Technology: "bg-cyan-500",
  "Arts & Media": "bg-pink-500",
};

const categoryStyles: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  Sciences: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    badge: "bg-emerald-100/80 text-emerald-800",
  },
  Mathematics: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
    badge: "bg-blue-100/80 text-blue-800",
  },
  "Business & Economics": {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    badge: "bg-amber-100/80 text-amber-800",
  },
  Technology: {
    bg: "bg-cyan-50",
    text: "text-cyan-700",
    border: "border-cyan-200",
    badge: "bg-cyan-100/80 text-cyan-800",
  },
  Humanities: {
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
    badge: "bg-orange-100/80 text-orange-800",
  },
  "English & Literature": {
    bg: "bg-violet-50",
    text: "text-violet-700",
    border: "border-violet-200",
    badge: "bg-violet-100/80 text-violet-800",
  },
  Languages: {
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
    badge: "bg-rose-100/80 text-rose-800",
  },
  "Arts & Media": {
    bg: "bg-pink-50",
    text: "text-pink-700",
    border: "border-pink-200",
    badge: "bg-pink-100/80 text-pink-800",
  },
};

function getSubjectCategory(s: SubjectNotes): string {
  const id = s.id;
  if (["biology", "chemistry", "physics", "environmental-management", "co-ordinated-sciences", "marine-science", "astronomy"].includes(id)) return "Sciences";
  if (["mathematics", "additional-mathematics"].includes(id)) return "Mathematics";
  if (["accounting", "business-studies", "economics", "enterprise"].includes(id)) return "Business & Economics";
  if (["computer-science", "ict", "design-and-technology"].includes(id)) return "Technology";
  if (["first-language-english", "english-second-language", "literature-in-english", "world-literature"].includes(id)) return "English & Literature";
  if (["french", "spanish", "portuguese", "german", "arabic-second-language", "latin"].includes(id)) return "Languages";
  if (["art-design", "art-and-design", "music", "drama", "media-studies"].includes(id)) return "Arts & Media";
  if (["history", "geography", "sociology", "psychology", "development-studies", "religious-studies", "global-perspectives", "travel-and-tourism", "physical-education", "agriculture", "food-and-nutrition"].includes(id)) return "Humanities";
  return "Sciences";
}

// ─── Full chapter document reader & 20-Min Yumna Masterclass Player ───────────

const TOTAL_LECTURE_SECONDS = 1200; // 20:00 exactly

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

type LectureSection = {
  title: string;
  tag: string;
  script: string;
};

function build20MinChapterLecture(chap: Chapter): LectureSection[] {
  const sections: LectureSection[] = [];
  const cleanIntro = cleanSpeechText(chap.intro);

  // 1. Welcome & Orientation
  sections.push({
    title: "Masterclass Kickoff & Big Picture",
    tag: "Part 1: Orientation",
    script: `Hello and welcome to your complete twenty-minute deep-dive masterclass for Chapter ${chap.number}: ${chap.title}. I am Yumna, your personal tutor. Over the next twenty minutes, we are not simply reading through notes. We are going to unpack every concept layer by layer, understand how it connects to everything else, explore real-world examples, and make sure you can answer any IGCSE exam question on this topic with complete confidence. Let me give you the big picture first. This chapter is one of the most important in your entire syllabus because it forms the backbone of the ideas that follow. Every examiner marking your script will be looking for evidence that you truly understand the underlying mechanism, not just a memorised definition. So throughout this masterclass, every time I give you a fact, I will also give you the reason why it works that way, and I will give you a worked example of how it appears in an exam question. Let's begin.`,
  });

  // 2. Real-world relevance
  sections.push({
    title: "Why This Concept Exists in the Real World",
    tag: "Part 2: Motivation",
    script: `Before we dive into the technical content, let's answer the most important question a student can ask: why does this actually matter outside the classroom? The answer for ${chap.title} is this. ${cleanIntro.slice(0, 300)}. Now let me give you a real-world example to anchor this. Think about the last time you encountered something related to this topic in your daily life. Scientists, engineers, doctors, economists, and designers all rely on these exact principles every single day. When you understand the principle behind it rather than just the words, you gain the ability to apply it to situations you have never seen before, which is precisely what top-grade questions demand. Keep that motivation in mind throughout this entire masterclass.`,
  });

  // 3. Decoding first principles
  sections.push({
    title: "First Principles & Fundamental Definitions",
    tag: "Part 3: Definitions",
    script: `Now let's build the foundation. The most common mistake students make is trying to memorise a definition word-for-word without understanding what each part of that definition actually means. Let's decode it piece by piece. The core definition here is: ${cleanIntro.slice(0, 280)}. Notice that this definition has two parts. The first part tells you what the thing is. The second part tells you what it does or how it behaves. When an examiner awards marks for a definition, they are looking for both parts. Writing only one of them costs you half the marks. So let me say it again, more slowly. First: identify the subject. Second: explain its function or behaviour. Third: if possible, state the conditions under which it applies. If you follow that three-part structure every time, you will never lose a definition mark again.`,
  });

  // 4. Subheadings deep elaboration
  chap.subheadings.forEach((sub, sIdx) => {
    const cleanBody = cleanSpeechText(sub.body);
    const bullets = sub.groups
      .flatMap((g) => g.bullets)
      .map((b) => cleanSpeechText(b))
      .filter(Boolean);

    // Concept Exploration — expanded with cause-effect reasoning
    sections.push({
      title: `${sub.title}: Concept Breakdown`,
      tag: `Topic ${sIdx + 1}A`,
      script: `Let's move into our next key topic: ${sub.title}. I want you to really understand this one, not just memorise it, so let's break it down in three stages. Stage one: what is it? Stage two: how does it work step by step? Stage three: what does it connect to? Here is the explanation. ${cleanBody.slice(0, 350)}. Now let's think about the mechanism. There is always a cause and an effect. When you change one input, a specific output changes as a consequence. Being able to trace that chain from cause to effect, using precise terminology at every step, is what an examiner rewards with full marks. Let me highlight the most important part of this concept that students most often get wrong or oversimplify.`,
    });

    // Practical worked examples & key bullet points — expanded
    if (bullets.length > 0) {
      const topBullets = bullets.slice(0, Math.min(4, bullets.length)).join(". Next: ");
      sections.push({
        title: `${sub.title}: Key Syllabus Points & Examples`,
        tag: `Topic ${sIdx + 1}B`,
        script: `Now let's go through the specific details for ${sub.title} that mark schemes test directly. I am going to go through each point carefully, explain why it is true, and give you an example for each one. Point one: ${topBullets}. For each of these, imagine an examiner asking you to explain the significance. A weak answer simply states the fact. A strong answer states the fact, explains the underlying mechanism, and gives a specific example or application. For instance, if you are asked about this in a structured question, start with the principle, then describe the process step by step, then conclude with the outcome. That three-step approach guarantees you cover everything the mark scheme is looking for.`,
      });
    }

    // Examiner Traps — richer and more specific
    sections.push({
      title: `${sub.title}: Examiner Pitfalls & How to Avoid Them`,
      tag: `Topic ${sIdx + 1}C`,
      script: `Here is something examiners know that most students don't realise until after the exam. For the topic of ${sub.title}, there are three classic mistakes that appear year after year in the examiner reports. Mistake one: using the correct term but in the wrong context. Mistake two: describing what happens without explaining why it happens. Mistake three: leaving out units, conditions, or qualifications that the mark scheme requires. Let me give you a strategy for each. For mistake one: always re-read the question and check you are answering what was actually asked. For mistake two: after every statement you write, ask yourself "why?" and add that reason. For mistake three: when in doubt, include the condition. Writing "under standard conditions" or "in a controlled environment" shows the examiner you understand the limits of the concept. These three habits alone can add five to eight marks to a typical exam paper.`,
    });
  });

  // 5. Synthesis — richer connections
  sections.push({
    title: "System Integration: Connecting All Concepts",
    tag: "Synthesis",
    script: `Now that we have analysed every individual section of Chapter ${chap.number}: ${chap.title}, let's zoom out and see the whole picture. In IGCSE exams, the highest-mark questions — typically the extended response or essay questions — require you to connect multiple ideas together rather than treat them as isolated facts. So let's practise that now. Every concept we covered today is part of a single system. The early sections defined the foundation. The middle sections showed the mechanisms and how they interact. The final sections showed the consequences and applications. When you answer a twelve-mark question, you should be moving through that same structure: foundation, mechanism, consequence. If you can draw a mental flowchart linking the topics from this chapter, you are ready for any synoptic question the examiner can write. Let's also think about how Chapter ${chap.number} connects to the chapters before and after it in the syllabus, because papers increasingly ask questions that span multiple topics.`,
  });

  // 6. Exam strategy — much more detailed
  sections.push({
    title: "Exam Question Walkthrough & Model Answers",
    tag: "Exam Strategy",
    script: `Let's now simulate a real IGCSE examination scenario using ${chap.title} as our topic. I want you to picture yourself in the exam hall. The question reads: "Explain the relationship between [the main concept] and [its consequence]. Use examples to support your answer. [6 marks]". How do you approach this? Here is the exact formula. Sentence one: state the precise definition of the main concept. Sentence two: describe the step-by-step mechanism or process. Sentence three: identify the consequence and explain why it follows from the mechanism. Sentence four: give a named, specific example — not a vague one. Sentence five: if you have time, state the exception or the condition under which this does not apply, because that shows the examiner the depth of your understanding. For a four-mark question, use sentences one through three. For a six-mark question, add sentence four. For an eight or ten mark question, add sentence five and a comparison or evaluation. Following this formula every single time removes the guesswork and ensures you systematically hit every mark scheme point.`,
  });

  // 7. Diagram mastery — more instructive
  sections.push({
    title: "Diagram & Visual Representation Mastery",
    tag: "Diagrams",
    script: `Pay very close attention to this section, because diagrams are worth more marks than most students realise. For Chapter ${chap.number}, exams regularly include diagram-based questions that ask you to label, annotate, complete, or interpret a visual representation of the concept. Here is how to approach every diagram question. First: identify what type of diagram it is — is it a process diagram, a structural diagram, a graph, or a cycle? Second: find the labels and arrows, because they tell you what the examiner expects you to name and explain. Third: every label you add should be accompanied by a brief function — not just the name. For example, do not just write the name of a structure. Write the name and add a colon followed by its specific function. This is the difference between one mark and two marks on every label. Fourth: if asked to sketch a diagram from memory, always include a title, labels with functions, arrows showing direction of process, and a scale or units if it involves quantities. Practise sketching the key diagrams from this chapter until you can reproduce them accurately in under two minutes.`,
  });

  // 8. Rapid Recall — expanded with actual technique
  sections.push({
    title: "Rapid Recall & Active Retrieval Checkpoint",
    tag: "Recall Drill",
    script: `This section uses the most powerful learning technique known to cognitive science: active retrieval. Research consistently shows that trying to recall information without looking at your notes strengthens your memory far more effectively than re-reading or highlighting. So here is what I want you to do right now. Pause mentally and ask yourself these three questions about ${chap.title}. Question one: what is the single most important definition from this chapter? Can you state it in two sentences without looking? Question two: what is the step-by-step process or mechanism? Can you describe it in the correct order? Question three: what is a real-world example or application of this concept that you could use in an exam answer? If you can answer all three confidently, you are in an excellent position. If any one of them feels uncertain, go back to your notes for that specific point, then close them and try again. This recall-and-verify cycle is how you build the long-term memory you need for exam day.`,
  });

  // 9. Conclusion — motivating and complete
  sections.push({
    title: "20-Minute Masterclass Conclusion & What to Do Next",
    tag: "Completion",
    script: `Congratulations. You have completed your full twenty-minute masterclass on Chapter ${chap.number}: ${chap.title}. In the last twenty minutes, you have covered the complete theoretical foundation, the step-by-step mechanisms, specific worked examples, examiner pitfalls to avoid, a model answer formula, diagram technique, and an active retrieval drill. That is the equivalent of a full private tutoring session compressed into twenty minutes. Here is what I recommend you do immediately after this session. First: open your physical notes or textbook and glance through Chapter ${chap.number} one more time — now that you have heard the full explanation, the written content will click into place much more easily. Second: attempt at least one past paper question on this topic, applying the model answer formula we practised. Third: come back and listen to this masterclass again in three to four days to consolidate the memory through spaced repetition. You have invested twenty minutes today that will save you hours of confusion in the exam hall. Keep up this dedication. You are building something extraordinary.`,
  });

  return sections;
}

// ─── Reading structure ────────────────────────────────────────────────────────
// The note data is one long string per paragraph, which renders as an unbroken
// wall. These helpers re-shape it into rows: "**Movement:** an action that…"
// becomes a label column beside a detail column, and a worked example split on
// blank lines becomes numbered steps with a highlighted answer.

const WORDS_PER_MINUTE = 230;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function readTime(words: number): string {
  return `${Math.max(1, Math.round(words / WORDS_PER_MINUTE))} min`;
}

type Lead = { label: string; rest: string };

function splitLead(text: string): Lead | null {
  const trimmed = text.trim();
  // The note corpus writes labels three ways: "**Movement:** detail",
  // "**Writing 'x'.** detail" and "**A mule** detail".
  const patterns = [
    /^\*\*([^*\n]{2,70}?)\s*[:—.]\s*\*\*\s+([\s\S]+)$/,
    /^\*\*([^*\n]{2,60}?)\*\*\s+([\s\S]+)$/,
  ];
  for (const pattern of patterns) {
    const m = trimmed.match(pattern);
    if (!m) continue;
    const label = m[1]!.replace(/[:.—]$/, "").trim();
    const rest = m[2]!.trim();
    if (!label || !rest) continue;
    return { label, rest };
  }
  return null;
}

const proseCell =
  "text-[14.5px] leading-[1.72] text-foreground/80 prose prose-sm dark:prose-invert max-w-none " +
  "prose-p:my-0 prose-strong:font-semibold prose-strong:text-foreground " +
  "prose-code:text-[12px] prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded " +
  "prose-code:before:content-none prose-code:after:content-none " +
  "[&_mark]:bg-yellow-200/70 dark:[&_mark]:bg-yellow-900/40 [&_mark]:rounded [&_mark]:px-0.5";

/** A list of bullets re-shaped as label/detail rows, falling back to dotted prose. */
function KeyPointList({
  items,
  color,
  accent = "border-border/60 bg-card",
}: {
  items: string[];
  color: string;
  accent?: string;
}) {
  return (
    <dl className={`divide-y divide-border/60 overflow-hidden rounded-2xl border ${accent}`}>
      {items.map((item, idx) => {
        const lead = splitLead(item.trim());
        if (!lead) {
          return (
            <div key={idx} className="flex items-start gap-3 px-4 py-3.5">
              <span className={`mt-2 size-1.5 shrink-0 rounded-full ${color} opacity-70`} />
              <div
                className={proseCell}
                dangerouslySetInnerHTML={{ __html: formatMathAndMarkdown(item) }}
              />
            </div>
          );
        }
        return (
          <div
            key={idx}
            className="grid gap-1 px-4 py-3.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:gap-5"
          >
            <dt className="text-[13.5px] font-bold leading-snug text-foreground">{lead.label}</dt>
            <dd>
              <div
                className={proseCell}
                dangerouslySetInnerHTML={{ __html: formatMathAndMarkdown(lead.rest) }}
              />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** One paragraph inside a worked example, classified by its leading label. */
function WorkedStep({ chunk }: { chunk: string }) {
  const lead = splitLead(chunk);
  const label = lead?.label ?? "";
  const body = lead?.rest ?? chunk;
  const stepNumber = label.match(/^step\s*(\d+)/i)?.[1];

  if (/^question$/i.test(label)) {
    return (
      <div className="rounded-xl border border-border/70 bg-muted/40 px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Question
        </p>
        <div
          className={`mt-1 ${proseCell}`}
          dangerouslySetInnerHTML={{ __html: formatMathAndMarkdown(body) }}
        />
      </div>
    );
  }

  if (stepNumber) {
    const title = label.replace(/^step\s*\d+\s*[—-]?\s*/i, "").trim();
    return (
      <div className="flex gap-3">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-[11px] font-black text-sky-600 dark:text-sky-400">
          {stepNumber}
        </span>
        <div className="min-w-0 flex-1">
          {title && (
            <p className="text-[12px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
              {title}
            </p>
          )}
          <div
            className={`mt-0.5 ${proseCell}`}
            dangerouslySetInnerHTML={{ __html: formatMathAndMarkdown(body) }}
          />
        </div>
      </div>
    );
  }

  if (/^(answer|result)\b/i.test(label)) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
          Answer
        </span>
        <div
          className="text-[15px] font-bold text-emerald-800 dark:text-emerald-300 prose prose-sm dark:prose-invert max-w-none prose-p:my-0 prose-strong:text-inherit"
          dangerouslySetInnerHTML={{ __html: formatMathAndMarkdown(body) }}
        />
      </div>
    );
  }

  return (
    <div className="border-l-2 border-amber-500/40 pl-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
        {label || "Note"}
      </p>
      <div
        className={`mt-1 ${proseCell}`}
        dangerouslySetInnerHTML={{ __html: formatMathAndMarkdown(body) }}
      />
    </div>
  );
}

function WorkedCalculation({ group }: { group: BulletGroup }) {
  const chunks = group.bullets.flatMap((b) =>
    b
      .split(/\n\s*\n/)
      .map((c) => c.trim())
      .filter(Boolean),
  );
  return (
    <div className="overflow-hidden rounded-2xl border border-sky-500/25 bg-sky-500/[0.04]">
      <div className="flex items-center justify-between gap-3 border-b border-sky-500/20 bg-sky-500/10 px-4 py-2.5">
        <p className="text-[13px] font-bold text-sky-800 dark:text-sky-300">{group.subTitle}</p>
        <span className="shrink-0 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">
          Step by step
        </span>
      </div>
      <div className="space-y-4 p-4">
        {chunks.map((chunk) => (
          <WorkedStep key={chunk} chunk={chunk} />
        ))}
      </div>
    </div>
  );
}

const bodyProse =
  "prose prose-base dark:prose-invert max-w-none " +
  "prose-headings:font-bold prose-headings:text-foreground " +
  "prose-h3:text-[17px] prose-h3:mt-6 prose-h3:mb-2 " +
  "prose-h4:text-[15px] prose-h4:mt-5 prose-h4:mb-1.5 " +
  "prose-p:leading-[1.8] prose-p:text-[15.5px] prose-p:text-foreground/85 prose-p:mb-4 " +
  "prose-strong:font-semibold prose-strong:text-foreground " +
  "prose-li:text-[14.5px] prose-li:leading-7 " +
  "prose-ol:ml-5 prose-ol:list-decimal prose-ol:space-y-1 " +
  "prose-ul:ml-5 prose-ul:list-disc prose-ul:space-y-1 " +
  "prose-table:text-sm prose-table:w-full " +
  "prose-th:bg-muted/60 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:text-xs prose-th:uppercase prose-th:tracking-wide " +
  "prose-td:px-3 prose-td:py-2 prose-td:text-foreground/85 " +
  "prose-code:text-[12.5px] prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-mono prose-code:before:content-none prose-code:after:content-none " +
  "[&_figure]:my-6 [&_mark]:bg-yellow-200/70 dark:[&_mark]:bg-yellow-900/40 [&_mark]:rounded [&_mark]:px-0.5";

function ProseBlock({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={`${bodyProse} ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: formatMathAndMarkdown(text) }}
    />
  );
}

function isWorkedGroup(group: BulletGroup): boolean {
  return /worked\s+(example|calculation)/i.test(group.subTitle ?? "");
}

function GroupPart({ group, color }: { group: BulletGroup; color: string }) {
  if (isWorkedGroup(group)) return <WorkedCalculation group={group} />;
  return (
    <div>
      {group.subTitle && (
        <div className="mb-2.5 flex items-center gap-2.5">
          <span className={`inline-block size-2 shrink-0 rounded-full ${color}`} />
          <h3 className="text-[14.5px] font-bold tracking-tight text-foreground">
            {group.subTitle}
          </h3>
          <span className="text-[11px] font-semibold text-muted-foreground">
            {group.bullets.length}
          </span>
        </div>
      )}
      <KeyPointList items={group.bullets} color={color} />
    </div>
  );
}

function sectionWords(sub: SubHeading): number {
  return (
    countWords(sub.body) +
    sub.groups.reduce((n, g) => n + countWords(g.bullets.join(" ")), 0) +
    countWords((sub.examinerTips ?? []).join(" ")) +
    countWords((sub.commonMistakes ?? []).join(" ")) +
    countWords((sub.recap ?? []).join(" "))
  );
}

function CalloutList({ items, tone }: { items: string[]; tone: "tips" | "mistakes" }) {
  const isTips = tone === "tips";
  return (
    <div
      className={`my-8 rounded-r-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs transition-all ${
        isTips
          ? "border-l-[5px] border-l-[#1d4ed8]"
          : "border-l-[5px] border-l-amber-500"
      }`}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
            isTips ? "bg-[#1d4ed8] text-white" : "bg-amber-500 text-white"
          }`}
        >
          {isTips ? <Lightbulb className="size-5" /> : <AlertTriangle className="size-5" />}
        </div>
        <h4 className="text-base font-bold text-slate-900 tracking-tight">
          {isTips ? "Examiner Tips and Tricks" : "Common Exam Mistakes"}
        </h4>
      </div>
      <div className="space-y-2 text-[14.5px] leading-relaxed text-slate-700">
        {items.map((item, idx) => (
          <p key={idx} className="m-0">{item}</p>
        ))}
      </div>
    </div>
  );
}

function ChapterFlashcardModal({
  open,
  onClose,
  chapter,
  subjectName,
  color,
}: {
  open: boolean;
  onClose: () => void;
  chapter: Chapter;
  subjectName?: string;
  color: string;
}) {
  const [cards, setCards] = useState<FlashcardItem[]>(() =>
    convertChapterToFlashcards(chapter, subjectName),
  );
  const [index, setIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [mastered, setMastered] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCards(convertChapterToFlashcards(chapter, subjectName));
    setIndex(0);
    setIsFlipped(false);
  }, [chapter.number, subjectName]);

  if (!open || cards.length === 0) return null;

  const current = cards[index] || cards[0]!;
  const isCardMastered = !!mastered[current.id];

  const handleNext = () => {
    setIsFlipped(false);
    setIndex((prev) => (prev + 1) % cards.length);
  };

  const handlePrev = () => {
    setIsFlipped(false);
    setIndex((prev) => (prev - 1 + cards.length) % cards.length);
  };

  const toggleMastered = () => {
    setMastered((prev) => ({ ...prev, [current.id]: !prev[current.id] }));
  };

  const handleShuffle = () => {
    setIsFlipped(false);
    setCards((prev) => [...prev].sort(() => Math.random() - 0.5));
    setIndex(0);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl rounded-3xl border border-border bg-card p-6 sm:p-8 shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <span
              className={`flex size-8 items-center justify-center rounded-xl text-white ${color}`}
            >
              <Layers className="size-4" />
            </span>
            <div>
              <h3 className="font-bold text-sm text-foreground">
                Chapter {chapter.number} Flashcards
              </h3>
              <p className="text-xs text-muted-foreground truncate max-w-[260px] sm:max-w-xs">
                {chapter.title}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Counter and Tools */}
        <div className="flex items-center justify-between py-3 text-xs text-muted-foreground">
          <span>
            Card {index + 1} of {cards.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleShuffle}
              className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted transition-colors"
            >
              <RotateCw className="size-3" /> Shuffle
            </button>
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-secondary-foreground">
              {current.category}
            </span>
          </div>
        </div>

        {/* 3D Flip Card */}
        <div
          onClick={() => setIsFlipped((v) => !v)}
          className="relative mt-2 min-h-[220px] sm:min-h-[260px] w-full cursor-pointer rounded-2xl border-2 border-border/80 bg-gradient-to-br from-background to-muted/30 p-6 flex flex-col items-center justify-center text-center shadow-md transition-all hover:border-primary/50 select-none"
        >
          <span className="absolute top-3 left-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {isFlipped ? "Answer / Official Marking Points" : "Question / Term"}
          </span>
          <span className="absolute top-3 right-4 text-[11px] font-medium text-primary hover:underline">
            Click to {isFlipped ? "flip back" : "reveal answer"}
          </span>

          <div className="my-auto px-2 w-full">
            {isFlipped ? (
              <div
                className="text-sm sm:text-base leading-relaxed text-foreground font-medium text-left space-y-2"
                dangerouslySetInnerHTML={{ __html: formatMathAndMarkdown(current.back) }}
              />
            ) : (
              <p className="text-base sm:text-lg font-bold text-foreground">{current.front}</p>
            )}
          </div>

          <div className="mt-auto pt-4 text-[11px] text-muted-foreground">
            {isFlipped ? "Tap to flip back" : "Tap card to flip and check official answer"}
          </div>
        </div>

        {/* Navigation & Mastery Controls */}
        <div className="mt-6 flex items-center justify-between gap-3 pt-2 border-t border-border/50">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrev}
              className="flex size-9 items-center justify-center rounded-xl border border-border bg-background hover:bg-muted transition-colors text-foreground"
              title="Previous Card"
            >
              <SkipBack className="size-4" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="flex size-9 items-center justify-center rounded-xl border border-border bg-background hover:bg-muted transition-colors text-foreground"
              title="Next Card"
            >
              <SkipForward className="size-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={toggleMastered}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
              isCardMastered
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                : "border border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            <CheckCircle2 className="size-3.5" />
            {isCardMastered ? "Mastered" : "Mark as Mastered"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChapterDoc({
  chapter,
  allChapters,
  color,
  subjectId,
  onBack,
  onNext,
  onPrev,
  onSelectChapter,
}: {
  chapter: Chapter;
  allChapters: Chapter[];
  color: string;
  subjectId: string;
  onBack: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSelectChapter?: (ch: Chapter) => void;
}) {
  const [masteredSections, setMasteredSections] = useState<Record<number, boolean>>({});
  const [revealedAnswers, setRevealedAnswers] = useState<Record<number, boolean>>({});
  const [expandedExam, setExpandedExam] = useState<Record<number, boolean>>({});
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [expandedTopics, setExpandedTopics] = useState<Record<string, boolean>>({});

  // Chatbot Drawer state matching media_1795273520836_423dc96f.png
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<
    Array<{ id: string; role: "agent" | "user"; text: string; time?: string }>
  >([
    {
      id: "init",
      role: "agent",
      text: "Hey! 👋 I'm ExamGlow AI. I have full syllabus knowledge of this chapter. How can I help you understand this topic, explain a tricky concept, or test your exam recall today?",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isCopied, setIsCopied] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Group chapters by section and topic for ExamGlow hierarchy
  const hierarchy = useMemo(() => {
    const sections: Record<string, Record<string, Chapter[]>> = {};
    allChapters.forEach((ch) => {
      const sec = ch.section || "General";
      const top = ch.topic || sec;
      if (!sections[sec]) sections[sec] = {};
      if (!sections[sec][top]) sections[sec][top] = [];
      sections[sec][top].push(ch);
    });
    return sections;
  }, [allChapters]);

  useEffect(() => {
    if (chapter.section) {
      setExpandedSections((prev) => ({ ...prev, [chapter.section!]: true }));
    }
    if (chapter.topic) {
      setExpandedTopics((prev) => ({ ...prev, [chapter.topic!]: true }));
    }
  }, [chapter.number, chapter.section, chapter.topic]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(`chapter_mastery_${subjectId}_${chapter.number}`);
      if (saved) {
        try {
          setMasteredSections(JSON.parse(saved));
        } catch {}
      }
    }
  }, [subjectId, chapter.number]);

  const toggleMastered = (idx: number) => {
    setMasteredSections((prev) => {
      const next = { ...prev, [idx]: !prev[idx] };
      if (next[idx]) sound.playCorrect();
      if (typeof window !== "undefined") {
        localStorage.setItem(
          `chapter_mastery_${subjectId}_${chapter.number}`,
          JSON.stringify(next),
        );
      }
      return next;
    });
  };

  const progressBarRef = useRef<HTMLDivElement>(null);

  function handleReaderScroll(e: ReactUIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const scrollable = el.scrollHeight - el.clientHeight;
    if (progressBarRef.current) {
      progressBarRef.current.style.transform = `scaleX(${scrollable > 8 ? Math.min(1, el.scrollTop / scrollable) : 0})`;
    }
  }

  useEffect(() => {
    const reset = () => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
      if (typeof window !== "undefined") {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    };
    reset();
    const raf1 = requestAnimationFrame(reset);
    const tm = setTimeout(reset, 30);
    if (progressBarRef.current) progressBarRef.current.style.transform = "scaleX(0)";
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(tm);
    };
  }, [chapter.number]);

  const [isAiLoading, setIsAiLoading] = useState(false);

  const handleSendChat = async () => {
    if (!chatInput.trim() || isAiLoading) return;
    const userText = chatInput.trim();
    const userMsg = { id: Date.now().toString(), role: "user" as const, text: userText };
    setMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setIsAiLoading(true);

    try {
      const topicContext = `You are DueOtter AI, a high-speed, direct tutor for ExamGlow. The student is currently studying "${chapter.title}" in ${subjectId}. Subtopics: ${chapter.subheadings.map((s) => s.title).join(", ")}. Answer the student's question directly, concisely, and accurately based on exam marking points and key definitions. Keep responses focused on this topic under 3 short paragraphs.`;

      const apiMessages = [
        { role: "system", content: topicContext },
        ...messages.map((m) => ({
          role: m.role === "agent" ? "assistant" : "user",
          content: m.text,
        })),
        { role: "user", content: userText },
      ];

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (res.ok) {
        const data = (await res.json()) as { text?: string };
        if (data.text) {
          setMessages((prev) => [
            ...prev,
            { id: (Date.now() + 1).toString(), role: "agent" as const, text: data.text! },
          ]);
          setIsAiLoading(false);
          chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
          return;
        }
      }
    } catch (e) {
      console.warn("Real-time AI fetch error, falling back:", e);
    }

    // High-speed fallback
    let reply = `In ${chapter.title}, remember to cite the exact chemical bonds, definitions, and functions.`;
    if (userText.toLowerCase().includes("reduce") || userText.toLowerCase().includes("reducing")) {
      reply = "Reducing sugars donate electrons to Cu²⁺ in Benedict's solution, forming a brick-red Cu₂O precipitate. Glucose, fructose, and galactose are reducing. Sucrose is non-reducing because both anomeric carbons are bonded.";
    } else if (userText.toLowerCase().includes("maltose") || userText.toLowerCase().includes("disaccharide")) {
      reply = "Maltose forms from two α-glucose molecules via an α-1,4-glycosidic bond. Sucrose is α-glucose + β-fructose (α-1,2). Lactose is β-galactose + β-glucose (β-1,4).";
    }

    setMessages((prev) => [
      ...prev,
      { id: (Date.now() + 1).toString(), role: "agent" as const, text: reply },
    ]);
    setIsAiLoading(false);
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="fixed inset-0 z-50 flex overflow-hidden bg-white text-slate-900 font-sans antialiased">
      {/* ── Left Sidebar: ExamGlow Style 'Revision Notes' ── */}
      <aside
        className={`w-80 shrink-0 border-r border-slate-200/90 bg-white flex flex-col h-full overflow-hidden transition-all duration-200 ${
          sidebarOpen ? "block" : "hidden lg:flex"
        }`}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900 tracking-tight">Revision Notes</h2>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-slate-400 hover:text-slate-600 p-1 rounded-md"
            aria-label="Close sidebar"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Action Buttons: [All topics] and [Search] */}
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-2xs transition-all"
            >
              <ArrowLeft className="size-3.5 text-slate-500" />
              <span>All topics</span>
            </button>
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-full border text-xs font-semibold shadow-2xs transition-all ${
                searchOpen
                  ? "bg-slate-200 border-slate-400 text-slate-900"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300"
              }`}
            >
              <Search className="size-3.5 text-slate-400" />
              <span>Search</span>
            </button>
          </div>

          {searchOpen && (
            <div className="mt-2.5">
              <input
                type="text"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder="Search notes in this topic..."
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 px-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Hierarchy Tree List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {Object.entries(hierarchy).map(([secTitle, topics]) => {
            const isSecOpen = expandedSections[secTitle] ?? true;
            const secChapters = Object.values(topics).flat();
            const secMastered = secChapters.filter((c) => masteredSections[c.number]).length;
            const secPct = secChapters.length ? Math.round((secMastered / secChapters.length) * 100) : 0;

            return (
              <div key={secTitle} className="space-y-1.5">
                {/* Section Header Accordion */}
                <button
                  type="button"
                  onClick={() =>
                    setExpandedSections((prev) => ({ ...prev, [secTitle]: !isSecOpen }))
                  }
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative size-5 shrink-0 flex items-center justify-center">
                      <svg className="size-5 -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="14" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                        <circle
                          cx="18"
                          cy="18"
                          r="14"
                          fill="none"
                          stroke="#1e293b"
                          strokeWidth="3"
                          strokeDasharray="88"
                          strokeDashoffset={88 - (88 * secPct) / 100}
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-slate-900 truncate leading-snug">
                        {secTitle}
                      </p>
                      <p className="text-[11px] font-medium text-slate-400">
                        {Object.keys(topics).length} Topics · {secChapters.length} Revision Notes
                      </p>
                    </div>
                  </div>
                  <span className="size-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <ChevronDown
                      className={`size-4 transition-transform duration-200 ${
                        isSecOpen ? "rotate-180" : ""
                      }`}
                    />
                  </span>
                </button>

                {/* Topics in Section */}
                {isSecOpen && (
                  <div className="pl-2 space-y-2">
                    {Object.entries(topics).map(([topTitle, chaps]) => {
                      const isTopOpen = expandedTopics[topTitle] ?? true;
                      const filteredChaps = sidebarSearch
                        ? chaps.filter((c) =>
                            c.title.toLowerCase().includes(sidebarSearch.toLowerCase()),
                          )
                        : chaps;

                      if (sidebarSearch && filteredChaps.length === 0) return null;

                      const topMastered = chaps.filter((c) => masteredSections[c.number]).length;
                      const topPct = chaps.length ? Math.round((topMastered / chaps.length) * 100) : 0;

                      return (
                        <div key={topTitle} className="space-y-1">
                          {/* Topic Accordion Button */}
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedTopics((prev) => ({ ...prev, [topTitle]: !isTopOpen }))
                            }
                            className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors text-left"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="relative size-4 shrink-0 flex items-center justify-center">
                                <svg className="size-4 -rotate-90" viewBox="0 0 36 36">
                                  <circle cx="18" cy="18" r="14" fill="none" stroke="#e2e8f0" strokeWidth="4" />
                                  <circle
                                    cx="18"
                                    cy="18"
                                    r="14"
                                    fill="none"
                                    stroke="#10b981"
                                    strokeWidth="4"
                                    strokeDasharray="88"
                                    strokeDashoffset={88 - (88 * (topPct || 25)) / 100}
                                    strokeLinecap="round"
                                  />
                                </svg>
                              </div>
                              <span className="text-[12.5px] font-semibold text-slate-800 truncate">
                                {topTitle}
                              </span>
                            </div>
                            <span className="size-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                              <ChevronDown
                                className={`size-3.5 transition-transform duration-200 ${
                                  isTopOpen ? "rotate-180" : ""
                                }`}
                              />
                            </span>
                          </button>

                          {/* Connected Vertical Timeline Tree */}
                          {isTopOpen && (
                            <div className="relative ml-4 pl-4 border-l-2 border-slate-200 space-y-1 py-1">
                              {filteredChaps.map((ch) => {
                                const isActive = ch.number === chapter.number;
                                const isMastered = !!masteredSections[ch.number];

                                return (
                                  <button
                                    key={ch.number}
                                    type="button"
                                    onClick={() => {
                                      if (scrollRef.current) {
                                        scrollRef.current.scrollTop = 0;
                                      }
                                      if (onSelectChapter) {
                                        onSelectChapter(ch);
                                      }
                                    }}
                                    className={`group relative w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left rounded-lg text-xs transition-colors ${
                                      isActive
                                        ? "bg-blue-50/90 text-blue-900 font-bold"
                                        : "text-slate-700 hover:text-slate-900 hover:bg-slate-50 font-medium"
                                    }`}
                                  >
                                    {/* Dot connected to vertical line */}
                                    <span
                                      className={`absolute -left-[23px] rounded-full flex items-center justify-center transition-all ${
                                        isActive
                                          ? "size-3.5 -left-[23px] bg-blue-600 ring-4 ring-blue-100"
                                          : isMastered
                                            ? "size-3.5 -left-[23px] bg-emerald-600 text-white ring-4 ring-emerald-50"
                                            : "size-2.5 -left-[21px] bg-slate-300"
                                      }`}
                                    >
                                      {isMastered ? (
                                        <CheckCircle2 className="size-2.5 fill-current text-white" />
                                      ) : null}
                                    </span>

                                    <span className="truncate leading-snug">{ch.title}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* ── Right Content Area: ExamGlow Document ── */}
      <main
        ref={scrollRef}
        onScroll={handleReaderScroll}
        className="flex-1 flex flex-col h-full overflow-y-auto overflow-x-hidden bg-white relative"
      >
        {/* Sticky Reading Progress bar in charcoal grey */}
        <div
          ref={progressBarRef}
          aria-hidden
          style={{ transform: "scaleX(0)" }}
          className="sticky top-0 z-30 h-[3px] origin-left bg-[#233831]"
        />

        {/* Top Control Bar */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#D8E0D2] bg-white px-4 py-2.5 sm:px-8">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden flex items-center gap-1.5 rounded-lg border border-[#D8E0D2] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#173128] hover:bg-[#F0F2E4]"
            >
              <Layers className="size-3.5 text-[#173128]" />
              <span>Notes</span>
            </button>
            <p className="text-xs text-[#5B6E62] font-medium hidden sm:block">
              {chapter.section || "Biology"} <span className="text-slate-300">/</span>{" "}
              {chapter.topic || chapter.title}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFlashcards(true)}
              className="flex items-center gap-1.5 rounded-full border border-[#D8E0D2] bg-white px-3 py-1.5 text-xs font-semibold text-[#173128] hover:bg-[#F0F2E4] transition-colors shadow-2xs"
            >
              <Layers className="size-3.5 text-[#233831]" />
              <span className="hidden sm:inline">Flashcards</span>
            </button>

            <button
              type="button"
              onClick={() => toggleMastered(chapter.number)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border transition-all ${
                masteredSections[chapter.number]
                  ? "border-[#233831] bg-[#E2EBDE] text-[#173128]"
                  : "border-[#D8E0D2] bg-white text-[#5B6E62] hover:bg-[#F0F2E4]"
              }`}
            >
              <CheckCircle2 className="size-3.5" />
              <span className="hidden sm:inline">
                {masteredSections[chapter.number] ? "Understood" : "Mark read"}
              </span>
            </button>
          </div>
        </div>

        {/* Note Document Article */}
        <article className="mx-auto w-full max-w-5xl xl:max-w-6xl px-4 sm:px-8 lg:px-12 py-8 sm:py-12 pb-36">
          {/* Main Chapter Title */}
          <header className="mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
              <h1 className="text-3xl sm:text-4xl font-extrabold text-[#0D170C] tracking-tight">
                {chapter.title}
              </h1>
              <div className="flex items-center gap-3 shrink-0">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-[#E2EBDE] text-[#173128] border border-[#D8E0D2]">
                  Exam code: {SYLLABUS_NOTES.find((s) => s.id === subjectId)?.code || "0610 / 0970"}
                </span>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded-full bg-[#233831] hover:bg-[#2C443C] text-white px-5 py-2 text-xs sm:text-sm font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                >
                  Download PDF
                </button>
              </div>
            </div>
          </header>

          {/* Subheadings and Note Content */}
          <div className="space-y-12">
            {chapter.subheadings.map((sub, si) => (
              <section id={`section-${si}`} key={si} className="scroll-mt-16">
                {/* Section Sub-heading matching ExamGlow */}
                <div className="mb-6 pb-2 border-b border-slate-100">
                  <h2 className="text-2xl sm:text-[28px] font-extrabold text-slate-900 tracking-tight">
                    {sub.title.toLowerCase().startsWith("biological") ? sub.title.toLowerCase() : sub.title}
                  </h2>
                </div>

                {/* Prose Body */}
                {sub.body && <ProseBlock text={sub.body} />}

                {/* Figure / Diagrams (rendered clean and big without container cards) */}
                {sub.figure ? (
                  <div className="w-full my-8 sm:my-12">
                    <ProseBlock text={sub.figure} />
                  </div>
                ) : null}

                {/* Group parts (if any) */}
                {sub.groups && sub.groups.length > 0 && (
                  <div className="my-8 space-y-6">
                    {sub.groups.map((grp, gi) => (
                      <GroupPart key={gi} group={grp} color={color} />
                    ))}
                  </div>
                )}

                {/* Examiner Tips and Tricks in Charcoal Grey */}
                {sub.examinerTips && sub.examinerTips.length > 0 && (
                  <CalloutList items={sub.examinerTips} tone="tips" />
                )}

                {/* Common Mistakes */}
                {sub.commonMistakes && sub.commonMistakes.length > 0 && (
                  <CalloutList items={sub.commonMistakes} tone="mistakes" />
                )}

                {/* Exam practice questions */}
                {sub.recap && sub.recap.length > 0 && (
                  <div className="mt-10 rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
                    <button
                      type="button"
                      onClick={() => setExpandedExam((prev) => ({ ...prev, [si]: !prev[si] }))}
                      className="w-full flex items-center justify-between gap-3 bg-slate-50/80 px-5 py-3.5 hover:bg-slate-100/70 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <HelpCircle className="size-4 text-slate-800" />
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                          Exam Practice ({sub.recap.length} Questions)
                        </span>
                      </div>
                      <ChevronDown
                        className={`size-4 text-slate-400 transition-transform duration-200 ${
                          expandedExam[si] ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {expandedExam[si] && (
                      <div className="p-5 space-y-5 bg-white divide-y divide-slate-100">
                        {sub.recap.map((q, qi) => (
                          <div key={qi} className="pt-4 first:pt-0 space-y-2">
                            <p className="text-[14px] font-semibold text-slate-900 leading-snug flex items-start gap-2.5">
                              <span className="size-5 rounded-full bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                                {qi + 1}
                              </span>
                              <span>{q}</span>
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                setRevealedAnswers((prev) => ({
                                  ...prev,
                                  [si * 100 + qi]: !prev[si * 100 + qi],
                                }));
                                sound.playFlip();
                              }}
                              className="ml-7 text-[12px] font-semibold text-slate-700 hover:underline flex items-center gap-1"
                            >
                              {revealedAnswers[si * 100 + qi] ? "Hide model answer hint" : "Show model answer hint"}
                              <ChevronDown
                                className={`size-3 transition-transform ${
                                  revealedAnswers[si * 100 + qi] ? "rotate-180" : ""
                                }`}
                              />
                            </button>
                            {revealedAnswers[si * 100 + qi] && (
                              <div className="ml-7 rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs text-slate-700 leading-relaxed">
                                State clear definitions, cite exact chemical bonds (e.g. 1,4 vs 1,6), mention reactants/products, and explain the biological functional advantage.
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>

          {/* Bottom 'Get unlimited access' Conversion Card matching ExamGlow */}
          <div className="mt-16 rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-10 shadow-xs">
            <div className="text-center max-w-xl mx-auto space-y-4">
              <span className="text-3xl block">👏</span>
              <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Get unlimited access
              </h3>

              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {[
                  "Downloadable PDFs",
                  "Unlimited Revision Notes",
                  "Exam Questions",
                  "Past Papers",
                  "Model Answers",
                  "Videos (Maths and Science)",
                ].map((feat) => (
                  <span
                    key={feat}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200"
                  >
                    <CheckCircle2 className="size-3.5 text-emerald-600" />
                    {feat}
                  </span>
                ))}
              </div>

              <div className="pt-6 border-t border-slate-100 mt-6">
                <p className="text-base font-bold text-slate-900">
                  Join the 100,000+ Students that ❤️ ExamGlow
                </p>
                <p className="text-xs text-slate-500 mt-0.5">the (exam) results speak for themselves:</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 text-left">
                  <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 text-xs text-slate-700 leading-relaxed">
                    "I would just like to say a massive thank you for putting together such a brilliant, easy to use website.{" "}
                    <span className="bg-slate-200 font-semibold text-slate-900 px-1 rounded">
                      I really think using this site helped me secure my top grades
                    </span>{" "}
                    in science and maths. You really saved my exams and grades! Thank you."
                  </div>
                  <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 text-xs text-slate-700 leading-relaxed">
                    "This website is soooo useful and I can't ever thank you enough for organising questions by topic like this.{" "}
                    <span className="bg-slate-200 font-semibold text-slate-900 px-1 rounded">
                      It literally SAVED MY GRADES!
                    </span>"
                  </div>
                </div>
              </div>
            </div>
          </div>
        </article>

        {/* Floating AI Action Button (When panel is closed) */}
        {!chatOpen && (
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            aria-label="Open AI Tutor Chat"
            className="fixed right-6 bottom-6 z-40 size-12 rounded-full bg-[#233831] text-white shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center border-2 border-white cursor-pointer hover:bg-[#2C443C]"
          >
            <Bot className="size-6 text-white" />
          </button>
        )}
      </main>

      {/* Docked AI Chat Panel (Non-hovering, space/margin from edges, matching image) */}
      {chatOpen && (
        <aside className="w-full sm:w-[420px] shrink-0 h-full p-4 pl-0 flex flex-col bg-[#F0F2E4] border-l border-[#D8E0D2] transition-all duration-200">
          <div className="h-full w-full rounded-3xl border border-[#D8E0D2] bg-white shadow-xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#D8E0D2] bg-white">
              <div className="flex items-center gap-2.5">
                <div className="size-8 rounded-xl bg-[#233831] text-white flex items-center justify-center font-bold text-xs shadow-xs">
                  <Bot className="size-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#0D170C] leading-tight">DueOtter AI</h3>
                </div>
              </div>

              {/* Action Icons */}
              <div className="flex items-center gap-1.5 text-[#5B6E62]">
                <button
                  type="button"
                  title="History"
                  className="p-1 hover:text-[#0D170C] rounded transition-colors"
                >
                  <RotateCcw className="size-4" />
                </button>
                <button
                  type="button"
                  title="New chat"
                  onClick={() =>
                    setMessages([
                      {
                        id: Date.now().toString(),
                        role: "agent",
                        text: `New session started for ${chapter.title}. How can I assist you?`,
                      },
                    ])
                  }
                  className="p-1 hover:text-[#0D170C] rounded transition-colors"
                >
                  <SquarePen className="size-4" />
                </button>
                <button
                  type="button"
                  title="Clear chat"
                  onClick={() => setMessages([])}
                  className="p-1 hover:text-[#0D170C] rounded transition-colors"
                >
                  <Trash2 className="size-4" />
                </button>
                <button
                  type="button"
                  title="Close panel"
                  onClick={() => setChatOpen(false)}
                  className="p-1 hover:text-[#0D170C] rounded transition-colors ml-1"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {/* Chat Body with subtle dot-grid background */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[radial-gradient(#CBD5C6_1px,transparent_1px)] [background-size:16px_16px] bg-[#F7F8F4]">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`${
                    m.role === "agent"
                      ? "bg-white rounded-2xl border border-[#D8E0D2] p-4 shadow-2xs space-y-2 text-[#0D170C]"
                      : "ml-auto max-w-[85%] bg-[#233831] text-white rounded-2xl px-4 py-2.5 text-xs sm:text-sm font-medium"
                  }`}
                >
                  {m.role === "agent" && (
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold tracking-wider text-[#233831] uppercase">
                        AGENT
                      </span>
                    </div>
                  )}

                  <p className="text-xs sm:text-[13.5px] leading-relaxed whitespace-pre-line m-0">
                    {m.text}
                  </p>

                  {m.role === "agent" && (
                    <div className="flex items-center gap-3 pt-2 text-[#5B6E62] border-t border-[#D8E0D2] text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(m.text);
                          setIsCopied(m.id);
                          setTimeout(() => setIsCopied(null), 1500);
                        }}
                        className="hover:text-[#0D170C] flex items-center gap-1 transition-colors"
                      >
                        {isCopied === m.id ? (
                          <Check className="size-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                        <span>{isCopied === m.id ? "Copied" : "Copy"}</span>
                      </button>
                      <button type="button" className="hover:text-[#0D170C] transition-colors">
                        <ThumbsUp className="size-3.5" />
                      </button>
                      <button type="button" className="hover:text-[#0D170C] transition-colors">
                        <ThumbsDown className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {isAiLoading && (
                <div className="bg-white rounded-2xl border border-[#D8E0D2] p-3 shadow-2xs flex items-center gap-2 text-xs text-[#5B6E62]">
                  <Loader2 className="size-4 animate-spin text-[#233831]" />
                  <span>Thinking...</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Footer */}
            <div className="p-3 border-t border-[#D8E0D2] bg-white">
              <div className="rounded-2xl border border-[#D8E0D2] bg-[#F7F8F4] p-2.5 shadow-2xs flex items-end gap-2 focus-within:border-[#233831] focus-within:bg-white transition-all">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChat();
                    }
                  }}
                  rows={2}
                  placeholder="Type @ to tag a resource or ask anything..."
                  className="w-full resize-none border-0 bg-transparent text-xs sm:text-sm text-[#0D170C] placeholder:text-[#8E9F93] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSendChat}
                  disabled={!chatInput.trim() || isAiLoading}
                  className="size-8 rounded-full bg-[#233831] text-white flex items-center justify-center shrink-0 hover:bg-[#2C443C] disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ArrowUp className="size-4" />
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Flashcards Modal */}
      {showFlashcards && (
        <ChapterFlashcardModal
          open={showFlashcards}
          onClose={() => setShowFlashcards(false)}
          chapter={chapter}
          subjectName={subjectId}
          color={color}
        />
      )}
    </div>
  );
}

// ─── Main Courses & Syllabus Notes Page Component ─────────────────────────────

export function SyllabusNotesPage() {
  const { subject: subjectId, chapter: chapterNumber, view: rawView, board, article: articleId } = Route.useSearch();
  const navigate = useNavigate();

  const selectedSubject = SYLLABUS_NOTES.find((s) => s.id === subjectId) ?? null;
  const activeChapter = selectedSubject?.chapters.find((c) => c.number === chapterNumber) ?? null;
  const activeArticle = STUDY_ARTICLES.find((a) => a.id === articleId || a.slug === articleId) ?? null;

  const view = rawView || (activeChapter ? "reader" : activeArticle ? "article" : subjectId ? "hub" : "directory");

  const goTo = (
    subject: string | null,
    chapter?: number,
    viewState?: string,
    boardName?: string,
    articleSlug?: string
  ) => {
    void navigate({
      to: "/syllabus-notes",
      search: () => {
        const next: NotesSearch = {};
        if (subject) next.subject = subject;
        if (chapter) next.chapter = chapter;
        if (viewState) next.view = viewState;
        if (boardName) next.board = boardName;
        if (articleSlug) next.article = articleSlug;
        return next;
      },
    });
  };

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});
  const [expandedGridTopics, setExpandedGridTopics] = useState<Record<string, boolean>>({
    "Characteristics, Classification & Features of Organisms": true,
  });

  const toggleSubject = (id: string) => {
    setExpandedSubjects((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    SYLLABUS_NOTES.forEach((s) => {
      all[s.id] = true;
    });
    setExpandedSubjects(all);
  };

  const collapseAll = () => {
    setExpandedSubjects({});
  };

  const categoryOrder = [
    "Sciences",
    "Mathematics",
    "Business & Economics",
    "Technology",
    "Humanities",
    "English & Literature",
    "Languages",
    "Arts & Media",
  ];

  const categories = useMemo(() => [
    "All",
    ...categoryOrder.filter((cat) =>
      SYLLABUS_NOTES.some((s) => getSubjectCategory(s) === cat)
    ),
  ], []);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: SYLLABUS_NOTES.length };
    SYLLABUS_NOTES.forEach((s) => {
      const cat = getSubjectCategory(s);
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, []);

  const totalChaptersAcrossAll = useMemo(() => {
    return SYLLABUS_NOTES.reduce((sum, s) => sum + s.chapters.length, 0);
  }, []);

  const filteredSubjects = useMemo(() => {
    return SYLLABUS_NOTES.filter((s) => {
      const matchCat = activeCategory === "All" || getSubjectCategory(s) === activeCategory;
      const q = search.trim().toLowerCase();
      if (!q) return matchCat;
      const matchSearch =
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.chapters.some((c) => c.title.toLowerCase().includes(q));
      return matchCat && matchSearch;
    });
  }, [activeCategory, search]);

  const openNextChapter = () => {
    if (!selectedSubject || !activeChapter) return;
    const idx = selectedSubject.chapters.findIndex((c) => c.number === activeChapter.number);
    const nextCh = selectedSubject.chapters[idx + 1];
    if (nextCh) goTo(selectedSubject.id, nextCh.number);
  };

  const openPrevChapter = () => {
    if (!selectedSubject || !activeChapter) return;
    const idx = selectedSubject.chapters.findIndex((c) => c.number === activeChapter.number);
    if (idx > 0) goTo(selectedSubject.id, selectedSubject.chapters[idx - 1]!.number);
  };

  // 1. NOTE READER VIEW
  if (activeChapter && selectedSubject) {
    return (
      <ChapterDoc
        key={activeChapter.number}
        chapter={activeChapter}
        allChapters={selectedSubject.chapters}
        color={selectedSubject.color}
        subjectId={selectedSubject.id}
        onBack={() => goTo(selectedSubject.id, undefined, "topics", board)}
        onNext={openNextChapter}
        onPrev={openPrevChapter}
        onSelectChapter={(ch) => goTo(selectedSubject.id, ch.number)}
      />
    );
  }

  // 2. ARTICLE READER VIEW
  if (activeArticle && selectedSubject) {
    return (
      <DashboardLayout
        crumbs={[
          { label: "Courses" },
          { label: selectedSubject.name },
          { label: "Guides" },
          { label: activeArticle.title },
        ]}
      >
        <div className="w-full max-w-4xl mx-auto py-6 font-sans">
          <div className="mb-6">
            <button
              type="button"
              onClick={() => goTo(selectedSubject.id, undefined, "hub")}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5B6E62] hover:text-[#0D170C] transition-colors"
            >
              <ArrowLeft className="size-4" />
              <span>Back to {selectedSubject.name} Revision</span>
            </button>
          </div>

          <article className="rounded-3xl border border-[#D8E0D2] bg-white p-6 sm:p-10 shadow-xs">
            <header className="mb-6 pb-6 border-b border-[#D8E0D2]">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[11px] font-bold uppercase tracking-wider bg-[#E2EBDE] text-[#173128] px-2.5 py-1 rounded-md border border-[#CBD5C6]">
                  {activeArticle.category}
                </span>
                <span className="text-xs text-[#5B6E62] font-medium">· {activeArticle.readTime}</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0D170C] tracking-tight leading-tight">
                {activeArticle.title}
              </h1>
              <p className="mt-2 text-sm text-[#465A4D]">{activeArticle.snippet}</p>
            </header>

            <div className="prose prose-slate max-w-none text-sm sm:text-base leading-relaxed text-[#173128] space-y-4">
              <div dangerouslySetInnerHTML={{ __html: formatMathAndMarkdown(activeArticle.body) }} />
            </div>

            <div className="mt-10 pt-6 border-t border-[#D8E0D2] flex items-center justify-between">
              <button
                type="button"
                onClick={() => goTo(selectedSubject.id, undefined, "boards")}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#233831] text-white text-xs font-semibold hover:bg-[#2C443C] transition-colors shadow-xs"
              >
                <span>Explore {selectedSubject.name} Revision Notes</span>
                <ChevronRight className="size-4" />
              </button>
            </div>
          </article>
        </div>
      </DashboardLayout>
    );
  }

  // 3. TOPICS GRID VIEW
  if (selectedSubject && view === "topics") {
    const sections: Record<string, Record<string, Chapter[]>> = {};
    selectedSubject.chapters.forEach((ch) => {
      const sec = ch.section || "General";
      const top = ch.topic || sec;
      if (!sections[sec]) sections[sec] = {};
      if (!sections[sec][top]) sections[sec][top] = [];
      sections[sec][top].push(ch);
    });

    return (
      <DashboardLayout
        crumbs={[
          { label: "Courses" },
          { label: selectedSubject.name },
          { label: "Revision Notes" },
          { label: "Topics" },
        ]}
      >
        <div className="w-full max-w-6xl mx-auto py-4 font-sans">
          <div className="mb-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => goTo(selectedSubject.id, undefined, "boards")}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5B6E62] hover:text-[#0D170C] transition-colors"
            >
              <ArrowLeft className="size-4" />
              <span>Back to Exam Boards</span>
            </button>
            <span className="text-xs text-[#5B6E62] font-medium">
              {board ? board.toUpperCase() : "CIE"} Syllabus
            </span>
          </div>

          <header className="mb-8">
            <h1 className="text-3xl font-extrabold text-[#0D170C] tracking-tight">
              {selectedSubject.name} Revision Topics
            </h1>
            <p className="mt-1 text-sm text-[#465A4D]">
              Select a chapter to study in-depth teacher notes, clear molecular illustrations, and examiner insights.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {Object.entries(sections).map(([secTitle, topicGroups]) => {
              const displaySecTitle = secTitle.replace(/^\d+\.\s*/, "");
              return (
                <div
                  key={secTitle}
                  className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs flex flex-col justify-between"
                >
                  <div>
                    {/* Topic Header: empty circle + Title */}
                    <div className="flex items-center gap-3 mb-3.5">
                      <span className="size-4.5 rounded-full border-2 border-slate-300 shrink-0" />
                      <h2 className="font-bold text-base text-slate-900 tracking-tight">
                        {displaySecTitle}
                      </h2>
                    </div>

                    {/* Subtopics */}
                    <div className="space-y-3">
                      {Object.entries(topicGroups).map(([topTitle, chaps]) => {
                        const isOpen = expandedGridTopics[topTitle] ?? false;
                        return (
                          <div
                            key={topTitle}
                            className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3.5 transition-all"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedGridTopics((prev) => ({
                                  ...prev,
                                  [topTitle]: !isOpen,
                                }))
                              }
                              className="w-full flex items-center justify-between gap-3 text-left cursor-pointer group"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className="size-4 rounded-full border-2 border-slate-300 shrink-0 group-hover:border-slate-400" />
                                <span className="font-semibold text-sm text-slate-800 truncate group-hover:text-slate-900">
                                  {topTitle}
                                </span>
                              </div>
                              <span
                                className={`size-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                                  isOpen
                                    ? "bg-blue-50 text-blue-600"
                                    : "bg-slate-100 text-slate-500 group-hover:bg-slate-200"
                                }`}
                              >
                                <ChevronDown
                                  className={`size-3.5 transition-transform duration-200 ${
                                    isOpen ? "rotate-180" : ""
                                  }`}
                                />
                              </span>
                            </button>

                            {isOpen && (
                              <div className="mt-3 pt-3 border-t border-slate-200/60 space-y-2 pl-1">
                                {chaps.map((ch) => (
                                  <button
                                    key={ch.number}
                                    type="button"
                                    onClick={() => goTo(selectedSubject.id, ch.number)}
                                    className="w-full flex items-center gap-3 text-left py-1.5 px-2 rounded-lg hover:bg-slate-100/80 transition-colors cursor-pointer group"
                                  >
                                    <span className="size-3.5 rounded-full border-2 border-slate-300 shrink-0 group-hover:border-blue-500" />
                                    <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600 truncate">
                                      {ch.title}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // 4. EXAM BOARD SELECTOR VIEW
  if (selectedSubject && view === "boards") {
    return (
      <DashboardLayout
        crumbs={[
          { label: "IGCSE" },
          { label: selectedSubject.name },
          { label: "Revision Notes" },
        ]}
      >
        <div className="w-full max-w-5xl mx-auto py-4 font-sans">
          <div className="mb-6">
            <button
              type="button"
              onClick={() => goTo(selectedSubject.id, undefined, "hub")}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
            >
              <ArrowLeft className="size-4" />
              <span>Back to {selectedSubject.name} Overview</span>
            </button>
          </div>

          <div className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-slate-200">
            <div className="max-w-2xl">
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                IGCSE {selectedSubject.name} Revision Notes
              </h1>
              <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                Clear, syllabus-aligned revision notes created by verified educators. Our resources focus on exam essentials, practical calculations, and marking schemes so students can revise efficiently with confidence.
              </p>
            </div>

            <div className="flex items-center justify-center p-6 bg-slate-50 border border-slate-200/80 rounded-2xl shrink-0">
              <div className="text-center space-y-1">
                <GraduationCap className="size-12 text-slate-800 mx-auto" />
                <span className="text-xs font-bold text-slate-900 block">Syllabus Aligned</span>
                <span className="text-[10px] text-slate-500 block">Updated for 2026/27</span>
              </div>
            </div>
          </div>

          <div className="space-y-3 max-w-3xl">
            <button
              type="button"
              onClick={() => goTo(selectedSubject.id, undefined, "topics", "cie")}
              className="group w-full flex items-center justify-between p-5 rounded-2xl border border-[#D8E0D2] bg-white hover:border-[#233831] hover:shadow-xs transition-all text-left cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className="size-10 rounded-xl bg-[#E2EBDE] font-bold text-xs flex items-center justify-center text-[#173128] shrink-0 border border-[#CBD5C6]">
                  CIE
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-[#0D170C] group-hover:text-[#233831]">
                    CIE IGCSE {selectedSubject.name} Revision Notes
                  </h3>
                  <p className="text-xs text-[#5B6E62] mt-0.5">
                    Complete syllabus specification with chapter breakdown and diagrams
                  </p>
                </div>
              </div>
              <ChevronRight className="size-5 text-[#8E9F93] group-hover:text-[#233831] group-hover:translate-x-1 transition-all" />
            </button>

            <button
              type="button"
              onClick={() => goTo(selectedSubject.id, undefined, "topics", "edexcel")}
              className="group w-full flex items-center justify-between p-5 rounded-2xl border border-[#D8E0D2] bg-white hover:border-[#233831] hover:shadow-xs transition-all text-left cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className="size-10 rounded-xl bg-[#E2EBDE] font-bold text-xs flex items-center justify-center text-[#173128] shrink-0 border border-[#CBD5C6]">
                  EDX
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-[#0D170C] group-hover:text-[#233831]">
                    Edexcel IGCSE {selectedSubject.name} Revision Notes
                  </h3>
                  <p className="text-xs text-[#5B6E62] mt-0.5">
                    Tailored core content with essential formulas and test strategies
                  </p>
                </div>
              </div>
              <ChevronRight className="size-5 text-[#8E9F93] group-hover:text-[#233831] group-hover:translate-x-1 transition-all" />
            </button>

            <button
              type="button"
              onClick={() => goTo(selectedSubject.id, undefined, "topics", "a-level")}
              className="group w-full flex items-center justify-between p-5 rounded-2xl border border-[#D8E0D2] bg-white hover:border-[#233831] hover:shadow-xs transition-all text-left cursor-pointer"
            >
              <div className="flex items-center gap-4">
                <div className="size-10 rounded-xl bg-[#E2EBDE] font-bold text-xs flex items-center justify-center text-[#173128] shrink-0 border border-[#CBD5C6]">
                  AL
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-[#0D170C] group-hover:text-[#233831]">
                    International A-Level {selectedSubject.name} Revision Notes
                  </h3>
                  <p className="text-xs text-[#5B6E62] mt-0.5">
                    Advanced module breakdown for AS and A2 examinations
                  </p>
                </div>
              </div>
              <ChevronRight className="size-5 text-[#8E9F93] group-hover:text-[#233831] group-hover:translate-x-1 transition-all" />
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // 5. SUBJECT REVISION HUB VIEW
  if (selectedSubject && view === "hub") {
    return (
      <DashboardLayout
        crumbs={[
          { label: "Courses" },
          { label: selectedSubject.name },
        ]}
      >
        <div className="w-full max-w-5xl mx-auto py-4 font-sans">
          <div className="mb-6">
            <button
              type="button"
              onClick={() => goTo(null)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5B6E62] hover:text-[#0D170C] transition-colors"
            >
              <ArrowLeft className="size-4" />
              <span>All Courses</span>
            </button>
          </div>

          <header className="mb-8">
            <h1 className="text-4xl font-extrabold text-[#0D170C] tracking-tight">
              IGCSE {selectedSubject.name} Revision
            </h1>
            <p className="mt-3 text-sm text-[#465A4D] leading-relaxed max-w-3xl">
              Getting ready for your IGCSE {selectedSubject.name} exam? Our teacher-written revision resources are here to help, giving you all the tools and knowledge you need to face your exam with confidence.
            </p>
          </header>

          <section className="mb-12">
            <h2 className="text-xl font-bold text-[#0D170C] mb-5">
              IGCSE {selectedSubject.name} Revision Resources
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Revision Notes Card */}
              <button
                type="button"
                onClick={() => goTo(selectedSubject.id, undefined, "boards")}
                className="group p-5 rounded-2xl border border-[#D8E0D2] bg-white hover:border-[#233831] hover:shadow-xs transition-all text-left flex flex-col justify-between h-40 cursor-pointer"
              >
                <div className="size-8 rounded-lg bg-[#E2EBDE] text-[#233831] flex items-center justify-center shadow-xs border border-[#CBD5C6]">
                  <BookOpen className="size-4" />
                </div>
                <div>
                  <p className="text-xs text-[#5B6E62] font-medium">IGCSE {selectedSubject.name}</p>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <h3 className="font-bold text-sm text-[#0D170C]">Revision Notes</h3>
                    <ChevronRight className="size-4 text-[#233831] group-hover:translate-x-1 transition-all" />
                  </div>
                </div>
              </button>

              {/* Exam Questions Card */}
              <button
                type="button"
                onClick={() => void navigate({ to: "/test" })}
                className="group p-5 rounded-2xl border border-[#D8E0D2] bg-white hover:border-[#233831] hover:shadow-xs transition-all text-left flex flex-col justify-between h-40 cursor-pointer"
              >
                <div className="size-8 rounded-lg bg-[#E2EBDE] text-[#233831] flex items-center justify-center shadow-xs border border-[#CBD5C6]">
                  <HelpCircle className="size-4" />
                </div>
                <div>
                  <p className="text-xs text-[#5B6E62] font-medium">IGCSE {selectedSubject.name}</p>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <h3 className="font-bold text-sm text-[#0D170C]">Exam Questions</h3>
                    <ChevronRight className="size-4 text-[#233831] group-hover:translate-x-1 transition-all" />
                  </div>
                </div>
              </button>

              {/* Flashcards Card */}
              <button
                type="button"
                onClick={() => goTo(selectedSubject.id, 1)}
                className="group p-5 rounded-2xl border border-[#D8E0D2] bg-white hover:border-[#233831] hover:shadow-xs transition-all text-left flex flex-col justify-between h-40 cursor-pointer"
              >
                <div className="size-8 rounded-lg bg-[#E2EBDE] text-[#233831] flex items-center justify-center shadow-xs border border-[#CBD5C6]">
                  <Layers className="size-4" />
                </div>
                <div>
                  <p className="text-xs text-[#5B6E62] font-medium">IGCSE {selectedSubject.name}</p>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <h3 className="font-bold text-sm text-[#0D170C]">Flashcards</h3>
                    <ChevronRight className="size-4 text-[#233831] group-hover:translate-x-1 transition-all" />
                  </div>
                </div>
              </button>

              {/* Mock Exams Card */}
              <button
                type="button"
                onClick={() => void navigate({ to: "/test" })}
                className="group p-5 rounded-2xl border border-[#D8E0D2] bg-white hover:border-[#233831] hover:shadow-xs transition-all text-left flex flex-col justify-between h-40 cursor-pointer"
              >
                <div className="size-8 rounded-lg bg-[#E2EBDE] text-[#233831] flex items-center justify-center shadow-xs border border-[#CBD5C6]">
                  <FileText className="size-4" />
                </div>
                <div>
                  <p className="text-xs text-[#5B6E62] font-medium">IGCSE {selectedSubject.name}</p>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <h3 className="font-bold text-sm text-[#0D170C]">Mock Exams</h3>
                    <ChevronRight className="size-4 text-[#233831] group-hover:translate-x-1 transition-all" />
                  </div>
                </div>
              </button>
            </div>
          </section>

          {/* Student Resource Articles Section (Real clickable guides) */}
          <section>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-[#0D170C]">
                Articles and resources for IGCSE {selectedSubject.name} students
              </h2>
              <span className="text-xs font-semibold text-[#5B6E62] bg-[#E2EBDE] border border-[#CBD5C6] px-3 py-1 rounded-full cursor-default">
                Latest
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {STUDY_ARTICLES.map((article) => (
                <button
                  key={article.id}
                  type="button"
                  onClick={() => goTo(selectedSubject.id, undefined, "article", undefined, article.id)}
                  className="group rounded-2xl border border-[#D8E0D2] bg-white p-4 shadow-2xs hover:border-[#233831] hover:shadow-sm transition-all text-left cursor-pointer flex flex-col gap-3"
                >
                  {/* Thumbnail */}
                  <div className="w-full h-28 rounded-xl bg-gradient-to-br from-[#E2EBDE] to-[#D5DEC9] flex flex-col justify-between p-3 shrink-0 border border-[#CBD5C6]">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-[#173128] bg-white/70 w-fit px-1.5 py-0.5 rounded">
                      {article.category}
                    </span>
                    <span className="text-xs font-extrabold text-[#0D170C] leading-tight line-clamp-2">
                      {article.title}
                    </span>
                  </div>

                  <div className="flex-1 space-y-1">
                    <h3 className="font-bold text-sm text-[#0D170C] leading-snug line-clamp-2">
                      {article.title}
                    </h3>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] font-medium text-[#5B6E62]">
                        {article.readTime} read
                      </span>
                      <span className="text-[11px] font-semibold text-[#173128] group-hover:text-[#233831] transition-colors">
                        Read →
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </DashboardLayout>
    );
  }

  // 6. COURSES & SYLLABUS NOTES DIRECTORY LIST VIEW
  return (
    <DashboardLayout crumbs={[{ label: "Courses" }]}>
      <div className="w-full font-sans space-y-6 max-w-5xl mx-auto pb-16">
        {/* Top Header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-2 pb-1">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 mb-3 shadow-2xs">
              <span className="size-2 rounded-full bg-blue-600 animate-pulse" />
              <span>Syllabus Notes Directory · 2026/27 Aligned</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              Courses &amp; Revision Notes
            </h1>
            <p className="mt-2 text-sm text-slate-600 max-w-2xl leading-relaxed">
              Explore teacher-written revision notes across all syllabus specifications. Expand any course to view and read individual chapter notes.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-3.5 py-1.5 rounded-xl shadow-2xs">
              {SYLLABUS_NOTES.length} Courses · {totalChaptersAcrossAll} Total Notes
            </span>
          </div>
        </header>

        {/* Search Bar & Expand/Collapse Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by course name, syllabus code (e.g. 0610), or topic..."
              className="w-full pl-10 pr-9 py-2.5 text-sm bg-white rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 placeholder:text-slate-400 shadow-2xs transition-all"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                title="Clear search"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={expandAll}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
            >
              Expand All
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Category Pills Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar">
          {categories.map((cat) => {
            const count = categoryCounts[cat] ?? 0;
            const active = activeCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  active
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <span>{cat}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* The Course Notes List */}
        <div className="space-y-3">
          {filteredSubjects.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center space-y-3">
              <Search className="size-8 text-slate-400 mx-auto" />
              <h3 className="font-bold text-base text-slate-900">No matching courses or notes found</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                No syllabus notes matched &ldquo;{search}&rdquo;. Try another search keyword or clear filters.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setActiveCategory("All");
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition-colors shadow-xs cursor-pointer"
              >
                Reset Search
              </button>
            </div>
          ) : (
            filteredSubjects.map((sub) => {
              const cat = getSubjectCategory(sub);
              const styling = (categoryStyles[cat] ?? categoryStyles["Sciences"])!;
              const isExpanded = !!expandedSubjects[sub.id];

              return (
                <div
                  key={sub.id}
                  className="rounded-2xl border border-slate-200 bg-white hover:border-slate-300 transition-all p-4 sm:p-5 shadow-2xs"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    {/* Subject info */}
                    <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
                      <div
                        className={`size-11 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 border ${styling.bg} ${styling.text} ${styling.border}`}
                      >
                        {sub.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold text-base text-slate-900 truncate">{sub.name}</h3>
                          <span className="text-[11px] font-mono text-slate-600 bg-slate-100 border border-slate-200/80 px-2 py-0.5 rounded-md">
                            Code: {sub.code}
                          </span>
                          <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${styling.badge}`}>
                            {cat}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                          {sub.chapters.length} Chapters · {sub.chapters.slice(0, 4).map((c) => c.title).join(", ")}
                          {sub.chapters.length > 4 ? "..." : ""}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() => toggleSubject(sub.id)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors cursor-pointer"
                      >
                        <FileText className="size-3.5 text-slate-500" />
                        <span>{isExpanded ? "Hide notes" : `View ${sub.chapters.length} notes`}</span>
                        <ChevronDown
                          className={`size-3.5 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => goTo(sub.id, 1)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white transition-colors cursor-pointer shadow-2xs"
                      >
                        <span>Start Reading</span>
                        <ArrowRight className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Chapter Sub-list */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-slate-100 space-y-2.5 animate-in fade-in duration-150">
                      <div className="flex items-center justify-between pb-1">
                        <span className="text-xs font-bold text-slate-700">
                          Chapters &amp; Revision Notes ({sub.chapters.length}):
                        </span>
                        <button
                          type="button"
                          onClick={() => goTo(sub.id, undefined, "topics")}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
                        >
                          <span>Full syllabus overview</span>
                          <ChevronRight className="size-3" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
                        {sub.chapters.map((ch) => (
                          <button
                            key={ch.number}
                            type="button"
                            onClick={() => goTo(sub.id, ch.number)}
                            className="group flex items-center justify-between p-2.5 rounded-xl border border-slate-100 bg-slate-50/70 hover:bg-blue-50/70 hover:border-blue-200 transition-all text-left cursor-pointer"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 pr-2">
                              <span className="size-6 rounded-md bg-white border border-slate-200 text-[10px] font-bold text-slate-600 flex items-center justify-center shrink-0 group-hover:border-blue-300 group-hover:text-blue-700 shadow-2xs">
                                {ch.number}
                              </span>
                              <div className="min-w-0">
                                <span className="text-xs font-semibold text-slate-800 group-hover:text-blue-700 truncate block">
                                  {ch.title}
                                </span>
                                {ch.section && (
                                  <span className="text-[10px] text-slate-400 block truncate">
                                    {ch.section}
                                  </span>
                                )}
                              </div>
                            </div>
                            <span className="text-[11px] font-semibold text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 flex items-center gap-0.5">
                              <span>Read</span>
                              <ChevronRight className="size-3" />
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
