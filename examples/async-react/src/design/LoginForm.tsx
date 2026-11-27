import {startTransition, useOptimistic} from 'react'

import {CardContent, CardDescription, CardHeader, CardTitle} from '@/components/ui/card'
import {Field, FieldDescription, FieldGroup, FieldLabel} from '@/components/ui/field'
import {Input} from '@/components/ui/input'
import {Separator} from '@/components/ui/separator'

import Button from './Button'

export interface LoginFields {
  username: string
  password: string
}

export default function LoginForm({
  fields,
  changeAction,
  submitAction,
}: {
  fields: LoginFields
  changeAction: (field: keyof LoginFields, value: string) => void | Promise<void>
  submitAction: (fields: LoginFields) => Promise<void>
}) {
  const [optimisticFields, setOptimisticField] = useOptimistic(
    fields,
    (current, {field, value}: {field: keyof LoginFields; value: string}) => ({
      ...current,
      [field]: value,
    }),
  )

  function onChange(field: keyof LoginFields, value: string) {
    startTransition(async () => {
      setOptimisticField({field, value})
      await changeAction(field, value)
    })
  }

  return (
    <>
      <CardHeader>
        <h1 className="mt-0 text-2xl">Async React Course</h1>
        <Separator className="my-4" />
        <CardTitle>Login to your account</CardTitle>
        <CardDescription>Enter your email below to login to your account</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              value={optimisticFields.username}
              onChange={(e) => onChange('username', e.target.value)}
              type="email"
              placeholder="m@example.com"
            />
          </Field>
          <Field>
            <div className="flex items-center">
              <FieldLabel htmlFor="password">Password</FieldLabel>
            </div>
            <Input
              id="password"
              value={optimisticFields.password}
              onChange={(e) => onChange('password', e.target.value)}
              type="password"
            />
          </Field>
          <Field>
            <Button action={() => submitAction(optimisticFields)}>Login</Button>
            <FieldDescription className="text-center">
              Don't have an account? <a href="#">Tough!</a>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
    </>
  )
}
