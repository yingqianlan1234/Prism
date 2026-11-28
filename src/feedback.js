import { QUALITY_LABELS, providerLabel } from './utils/format.js';

export const FEEDBACK_LIMITS = Object.freeze({
  TITLE_MIN: 2,
  TITLE_MAX: 80,
  DESC_MIN: 10,
  DESC_MAX: 2000,
  CONTACT_MAX: 120,
});

export const FEEDBACK_CATEGORIES = Object.freeze([
  {
    id: 'bug',
    label: 'Bug 反馈',
    placeholder: '请描述遇到了什么问题、如何触发，以及你期望的正常表现…',
  },
  {
    id: 'feature',
    label: '功能建议',
    placeholder: '希望新增或优化什么功能？欢迎说说具体的听歌场景…',
  },
  {
    id: 'playback',
    label: '播放与音质',
    placeholder: '请描述无法播放、卡顿、音质切换或歌词匹配异常的曲目与现象…',
  },
  {
    id: 'other',
    label: '其他',
    placeholder: '有什么使用疑问、界面建议或其他想说的话，都可以写在这里…',
  },
]);

const VALID_CATEGORIES = new Set(FEEDBACK_CATEGORIES.map(c => c.id));

function cleanSingleLine(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
}

function cleanMultiline(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .trim();
}

export function charLength(value) {
  return [...String(value ?? '')].length;
}

export function validateFeedbackDraft({ category, title, description, contact }) {
  if (!VALID_CATEGORIES.has(category)) {
    return { valid: false, error: '请选择有效的反馈类型', normalized: null };
  }
  const cleanTitle = cleanSingleLine(title);
  const titleLen = charLength(cleanTitle);
  if (titleLen < FEEDBACK_LIMITS.TITLE_MIN) {
    return {
      valid: false,
      error: `标题至少需要 ${FEEDBACK_LIMITS.TITLE_MIN} 个字符`,
      normalized: null,
    };
  }
  if (titleLen > FEEDBACK_LIMITS.TITLE_MAX) {
    return {
      valid: false,
      error: `标题不能超过 ${FEEDBACK_LIMITS.TITLE_MAX} 个字符`,
      normalized: null,
    };
  }

  const cleanDesc = cleanMultiline(description);
  const descLen = charLength(cleanDesc);
  if (descLen < FEEDBACK_LIMITS.DESC_MIN) {
    return {
      valid: false,
      error: `请至少填写 ${FEEDBACK_LIMITS.DESC_MIN} 个字的详细描述，方便定位问题`,
      normalized: null,
    };
  }
  if (descLen > FEEDBACK_LIMITS.DESC_MAX) {
    return {
      valid: false,
      error: `详细描述不能超过 ${FEEDBACK_LIMITS.DESC_MAX} 个字符`,
      normalized: null,
    };
  }

  const cleanContact = cleanSingleLine(contact);
  if (charLength(cleanContact) > FEEDBACK_LIMITS.CONTACT_MAX) {
    return {
      valid: false,
      error: `联系方式不能超过 ${FEEDBACK_LIMITS.CONTACT_MAX} 个字符`,
      normalized: null,
    };
  }

  return {
    valid: true,
    error: '',
    normalized: {
      category,
      title: cleanTitle,
      description: cleanDesc,
      contact: cleanContact,
    },
  };
}

export function formatFeedbackEnvLines(context = {}) {
  const lines = [];
  if (context?.appVersion) {
    lines.push({ label: '应用版本', value: `Vesper v${context.appVersion}` });
  }
  if (context?.activeProvider) {
    lines.push({
      label: '当前音频源',
      value: providerLabel(context.activeProvider) || context.activeProvider,
    });
  }
  if (context?.neteaseQuality) {
    lines.push({
      label: '网易云音质',
      value: QUALITY_LABELS[context.neteaseQuality] || context.neteaseQuality,
    });
  }
  if (context?.qqQuality) {
    lines.push({
      label: 'QQ 音乐音质',
      value: QUALITY_LABELS[context.qqQuality] || context.qqQuality,
    });
  }
  if (context?.theme) {
    lines.push({ label: '当前主题', value: context.theme });
  }
  return lines;
}

export function buildFeedbackCopyText({
  category,
  title,
  description,
  contact,
  includeEnv,
  envLines = [],
}) {
  const cat = FEEDBACK_CATEGORIES.find(c => c.id === category);
  const cleanTitle = cleanSingleLine(title) || '（未填写标题）';
  const cleanDesc = cleanMultiline(description) || '（未填写详细描述）';
  const cleanContact = cleanSingleLine(contact);

  const parts = [
    `【Vesper 问题反馈】`,
    `分类：${cat ? cat.label : category || '其他'}`,
    `标题：${cleanTitle}`,
    '',
    '描述：',
    cleanDesc,
  ];
  if (cleanContact) {
    parts.push('', `联系方式：${cleanContact}`);
  }
  if (includeEnv && envLines.length > 0) {
    parts.push('', '运行环境（已脱敏）：');
    for (const item of envLines) {
      parts.push(`- ${item.label}：${item.value}`);
    }
  }
  return parts.join('\n');
}
