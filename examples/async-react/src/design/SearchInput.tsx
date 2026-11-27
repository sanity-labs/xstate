import {SearchIcon} from 'lucide-react'

import {InputGroup, InputGroupAddon, InputGroupInput} from '@/components/ui/input-group'
import {Spinner} from '@/components/ui/spinner'
import {cn} from '@/lib/utils'

import ButtonShimmer from './ButtonShimmer'

export default function SearchInput({
  value,
  isPending,
  onChange,
}: {
  value: string
  isPending: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="px-8">
      <InputGroup className="relative overflow-hidden">
        <InputGroupInput
          placeholder="Search..."
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupAddon
          align="inline-end"
          className={cn('pending', {'isPending long': isPending})}
        >
          <Spinner />
        </InputGroupAddon>
        <ButtonShimmer isPending={isPending} long />
      </InputGroup>
    </div>
  )
}
