const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
export const SendIcon = () => (<svg {...base}><path d="M5 12h13" /><path d="M13 6l6 6-6 6" /></svg>);
export const NoteIcon = () => (<svg {...base} width={16} height={16}><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>);
export const BackIcon = () => (<svg {...base}><path d="M15 5l-7 7 7 7" /></svg>);
export const CheckIcon = () => (<svg {...base} width={11} height={11} strokeWidth={3}><path d="M5 12.5l4.5 4.5L19 7" /></svg>);
export const LockIcon = () => (<svg {...base} width={11} height={11}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>);
