// Estilos de cor das etapas do pipeline. Strings de classe completas
// (não interpoladas) pro JIT do Tailwind detectar todas. `dot` = bolinha,
// `badge` = pill da etapa, `accent` = fundo suave do cabeçalho da coluna.
export type StageStyle = { dot: string; badge: string; accent: string }

export const STAGE_COLOR_STYLES: Record<string, StageStyle> = {
  slate: { dot: 'bg-slate-500', badge: 'bg-slate-100 text-slate-700', accent: 'bg-slate-50/60' },
  red: { dot: 'bg-red-500', badge: 'bg-red-100 text-red-700', accent: 'bg-red-50/60' },
  orange: {
    dot: 'bg-orange-500',
    badge: 'bg-orange-100 text-orange-700',
    accent: 'bg-orange-50/60',
  },
  amber: { dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700', accent: 'bg-amber-50/60' },
  yellow: {
    dot: 'bg-yellow-500',
    badge: 'bg-yellow-100 text-yellow-700',
    accent: 'bg-yellow-50/60',
  },
  lime: { dot: 'bg-lime-500', badge: 'bg-lime-100 text-lime-700', accent: 'bg-lime-50/60' },
  green: { dot: 'bg-green-500', badge: 'bg-green-100 text-green-700', accent: 'bg-green-50/60' },
  emerald: {
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700',
    accent: 'bg-emerald-50/60',
  },
  teal: { dot: 'bg-teal-500', badge: 'bg-teal-100 text-teal-700', accent: 'bg-teal-50/60' },
  cyan: { dot: 'bg-cyan-500', badge: 'bg-cyan-100 text-cyan-700', accent: 'bg-cyan-50/60' },
  sky: { dot: 'bg-sky-500', badge: 'bg-sky-100 text-sky-700', accent: 'bg-sky-50/60' },
  blue: { dot: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700', accent: 'bg-blue-50/60' },
  indigo: {
    dot: 'bg-indigo-500',
    badge: 'bg-indigo-100 text-indigo-700',
    accent: 'bg-indigo-50/60',
  },
  violet: {
    dot: 'bg-violet-500',
    badge: 'bg-violet-100 text-violet-700',
    accent: 'bg-violet-50/60',
  },
  purple: {
    dot: 'bg-purple-500',
    badge: 'bg-purple-100 text-purple-700',
    accent: 'bg-purple-50/60',
  },
  fuchsia: {
    dot: 'bg-fuchsia-500',
    badge: 'bg-fuchsia-100 text-fuchsia-700',
    accent: 'bg-fuchsia-50/60',
  },
  pink: { dot: 'bg-pink-500', badge: 'bg-pink-100 text-pink-700', accent: 'bg-pink-50/60' },
  rose: { dot: 'bg-rose-500', badge: 'bg-rose-100 text-rose-700', accent: 'bg-rose-50/60' },
}

export function stageStyle(color?: string): StageStyle {
  return (color && STAGE_COLOR_STYLES[color]) || STAGE_COLOR_STYLES.slate
}
