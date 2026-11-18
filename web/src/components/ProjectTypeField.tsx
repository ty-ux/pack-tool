import { useId } from 'react'
import { Radio } from 'antd'
import type { ProjectType } from '../types'

export const PROJECT_TYPES: Record<ProjectType, string> = {
  uniapp: 'uni-app',
  android: '原生 Android',
  flutter: 'Flutter',
  'react-native': 'React Native',
}

interface Props {
  value: ProjectType
  onChange: (value: ProjectType) => void
}

export function ProjectTypeField({ value, onChange }: Props) {
  const name = useId()
  return (
    <fieldset className="field project-type-field">
      <legend className="field-label">工程类型</legend>
      <Radio.Group name={name} value={value} onChange={(event) => onChange(event.target.value)}>
        {Object.entries(PROJECT_TYPES).map(([type, label]) => (
          <Radio key={type} value={type}>{label}</Radio>
        ))}
      </Radio.Group>
    </fieldset>
  )
}
