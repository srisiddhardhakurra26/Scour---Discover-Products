import { Header } from '@/components/Header'
import { SearchBar } from '@/components/SearchBar'
import { ClusteredProductsLoading } from '@/components/ClusteredProductsSection'
import { AllResultsLoading } from '@/components/AllResultsView'

// Shown instantly on navigation to /search — including switching views (?view=)
// — so the page never looks frozen while server components stream in.
export default function SearchLoading() {
  return (
    <>
      <Header>
        <div className="hidden w-full max-w-xl md:block">
          <SearchBar size="sm" />
        </div>
      </Header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-6">
        <div className="md:hidden">
          <SearchBar />
        </div>
        <div className="flex flex-col gap-10">
          <ClusteredProductsLoading />
          <AllResultsLoading />
        </div>
      </main>
    </>
  )
}
