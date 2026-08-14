import { useState } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { CareAlertSettings } from '@/components/crm/CareAlertSettings'
import { CareAlertHistory } from '@/components/crm/CareAlertHistory'
import { FollowupRulesManager } from '@/components/crm/FollowupRulesManager'
import { MessageTemplatesSection } from '@/components/crm/MessageTemplatesSection'
import { SilencePeriodsSection } from '@/components/crm/SilencePeriodsSection'
import { FollowupThresholdsSection } from '@/components/crm/FollowupThresholdsSection'

interface CareAlertsSheetProps {
  accountId: string
}

export function CareAlertsSheet({ accountId }: CareAlertsSheetProps) {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full gap-1.5 shrink-0">
          <Bell className="w-4 h-4" />
          Alertas
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-serif text-primary">Alertas de Cuidado</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-6">
          <CareAlertSettings accountId={accountId} />
          <Separator />
          <FollowupRulesManager accountId={accountId} />
          <Separator />
          <FollowupThresholdsSection accountId={accountId} />
          <Separator />
          <MessageTemplatesSection accountId={accountId} />
          <Separator />
          <SilencePeriodsSection accountId={accountId} />
          <Separator />
          <CareAlertHistory accountId={accountId} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
