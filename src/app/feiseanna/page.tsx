import { redirect } from 'next/navigation'

// The home page is the list of feiseanna; this older address points there
export default function BrowseFeiseannaPage() {
  redirect('/')
}
