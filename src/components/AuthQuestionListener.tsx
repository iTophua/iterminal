import { useEffect, useState } from 'react'
import { Alert, Form, Input, Modal, Typography } from 'antd'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

/** 后端发来的一道验证提问，见 src-tauri 的 auth_prompt.rs */
interface AuthQuestion {
  id: string
  host: string
  port: number
  username: string
  name: string
  instruction: string
  prompts: { prompt: string; echo: boolean }[]
}

/**
 * 服务器登录时要求交互式验证（动态口令、短信验证码等）的提问框。
 * 挂在应用根上，全局只此一个；后端建连期间原地等这里的回答。
 */
export default function AuthQuestionListener() {
  // 多个连接可能同时要验证：排队一次问一个，先来的先答
  const [queue, setQueue] = useState<AuthQuestion[]>([])
  const [form] = Form.useForm()
  const question = queue[0] ?? null

  useEffect(() => {
    const unlisten = listen<AuthQuestion>('ssh-auth-question', event => {
      setQueue(prev => [...prev, event.payload])
    })
    return () => {
      void unlisten.then(fn => fn())
    }
  }, [])

  const answer = async (answers: string[] | null) => {
    const current = queue[0]
    setQueue(prev => prev.slice(1))
    if (current) await invoke('answer_auth_question', { id: current.id, answers }).catch(() => {})
  }

  return (
    <Modal
      open={question !== null}
      title="服务器要求验证"
      okText="提交"
      cancelText="取消"
      closable={false}
      maskClosable={false}
      onCancel={() => void answer(null)}
      onOk={() =>
        void answer((question?.prompts ?? []).map((_, i) => String(form.getFieldValue(`q${i}`) ?? '')))
      }
      afterClose={form.resetFields}
    >
      {question && (
        <>
          <Typography.Paragraph>
            正在登录{' '}
            <Typography.Text strong>
              {question.username}@{question.host}:{question.port}
            </Typography.Text>
            ，服务器要求完成验证后才能继续。
          </Typography.Paragraph>
          {question.name && <Typography.Paragraph strong>{question.name}</Typography.Paragraph>}
          {question.instruction && <Alert type="info" message={question.instruction} style={{ marginBottom: 12 }} />}
          <Form form={form} layout="vertical">
            {question.prompts.map((prompt, i) => (
              <Form.Item key={`${question.id}-${i}`} name={`q${i}`} label={prompt.prompt || '回答'}>
                {prompt.echo ? (
                  <Input autoFocus={i === 0} autoComplete="off" />
                ) : (
                  <Input.Password autoFocus={i === 0} autoComplete="one-time-code" />
                )}
              </Form.Item>
            ))}
          </Form>
        </>
      )}
    </Modal>
  )
}
