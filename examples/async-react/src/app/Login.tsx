import {useActor, useOptimisticSend} from '@sanity-labs/xstate-react'
import {createMachine, types} from 'xstate'

import * as data from '@/data/index'
import * as Design from '@/design'
import type {LoginFields} from '@/design/LoginForm'
import {Router} from '@/router/index'

const loginFormMachine = createMachine({
  schemas: {
    context: types<LoginFields>(),
    events: {'field.change': types<{field: keyof LoginFields; value: string}>()},
  },
  context: {username: 'hi@react.dev', password: 'reactisgoodactually'},
  on: {
    'field.change': ({context, event}) => ({context: {...context, [event.field]: event.value}}),
  },
})

export default function Login() {
  const [form, , formActor] = useActor(loginFormMachine)
  const sendField = useOptimisticSend(formActor)
  const send = Router.useSend()
  const revision = Router.useSelector(({context}) => context.revision)

  async function submitAction() {
    await data.login(form.context)
    // Logging in completes to the home page with its lessons when they load within a second, and
    // to its fallback otherwise.
    await data.prefetchLessons(revision)
    send({type: 'navigate', path: '/'})
  }

  return (
    <Design.LoginForm
      fields={form.context}
      onChange={(field, value) => sendField({type: 'field.change', field, value})}
    >
      <Design.Button action={submitAction}>Login</Design.Button>
    </Design.LoginForm>
  )
}
