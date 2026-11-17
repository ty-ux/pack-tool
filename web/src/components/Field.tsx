import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'

interface Props {
  label: string
  required?: boolean
  hint?: ReactNode
  children: ReactNode
}

/** 表单字段包装：label + 控件 + hint（自动关联 htmlFor，保证可访问性） */
export function Field({ label, required, hint, children }: Props) {
  const id = useId()
  const hintId = hint != null ? `${id}-hint` : undefined
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; 'aria-describedby'?: string }>, {
        id,
        ...(hintId ? { 'aria-describedby': hintId } : {}),
      })
    : children
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
        {required && <span className="req">*</span>}
      </label>
      {child}
      {hintId && <div id={hintId} className="hint">{hint}</div>}
    </div>
  )
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="field-row">{children}</div>
}
