# Package Matrix: iDEP Web vs Electron vs iDEP (now)

**Date:** 2026-03-26

- **iDEP web (Dec 2025):** In DESCRIPTION `Imports` at PR #818 merge (2025-12-03)
- **Electron:** Would the Electron CI workflow install this successfully?
- **iDEP (now):** In current DESCRIPTION `Imports`

| Package | iDEP web | Electron | iDEP now | Issue |
|---------|:--------:|:--------:|:--------:|-------|
| Biobase | ✗ | L/M only | ✓ | Not in Windows hardcoded bioc list |
| BiocGenerics | ✗ | ~ | ✓ | Not in hardcoded bioc list; likely transitive dep |
| BiocManager | ✗ | ✓ | ✓ | |
| biclust | ✓ | ✗ | ✓ | Archived from CRAN, no special handling |
| bslib | ✓ | ✓ | ✓ | |
| circlize | ✓ | ✓ | ✓ | |
| colorspace | ✗ | ✓ | ✓ | |
| ComplexHeatmap | ✓ | ✓ | ✓ | |
| config | ✓ | ✓ | ✓ | |
| data.table | ✗ | ✓ | ✓ | |
| DBI | ✓ | ✓ | ✓ | |
| dendextend | ✓ | ✓ | ✓ | |
| DESeq2 | ✓ | ✓ | ✓ | |
| dplyr | ✓ | ✓ | ✓ | |
| DT | ✓ | ✓ | ✓ | |
| dynamicTreeCut | ✓ | ✓ | ✓ | |
| e1071 | ✓ | ✓ | ✓ | |
| edgeR | ✓ | ✓ | ✓ | |
| factoextra | ✓ | ✓ | ✓ | |
| fgsea | ✓ | ✓ | ✓ | |
| flashClust | ✓ | ✓ | ✓ | |
| gage | ✓ | ✓ | ✓ | |
| GenomicRanges | ✗ | ~ | ✓ | Not in hardcoded bioc list; likely transitive dep |
| GetoptLong | ✓ | ✓ | ✓ | |
| ggalt | ✓ | ✓ | ✓ | Special-case archive install; optional on Mac |
| ggplot2 | ✓ | ✓ | ✓ | |
| ggpubr | ✗ | ✓ | ✓ | |
| ggraph | ✓ | ✓ | ✓ | |
| ggrepel | ✗ | ✓ | ✓ | |
| ggupset | ✓ | ✓ | ✓ | |
| GO.db | ✗ | L/M only | ✓ | Not in Windows hardcoded bioc list |
| golem | ✓ | ✓ | ✓ | |
| GSVA | ✓ | ✓ | ✓ | Treated as optional on Linux |
| hexbin | ✓ | ✓ | ✓ | |
| hgu133plus2.db | ✓ | ✓ | ✓ | |
| htmltools | ✓ | ✓ | ✓ | |
| igraph | ✓ | ✓ | ✓ | |
| InteractiveComplexHeatmap | ✓ | ✓ | ✓ | |
| IRanges | ✗ | ~ | ✓ | Not in hardcoded bioc list; likely transitive dep |
| kableExtra | ✗ | ✓ | ✓ | |
| KEGG.db | ✗ | ✗ | ✓ | Archived from Bioc 2.11, no special handling |
| KEGGREST | ✗ | L/M only | ✓ | Not in Windows hardcoded bioc list |
| knitr | ✓ | ✓ | ✓ | |
| limma | ✗ | L/M only | ✓ | Not in Windows hardcoded bioc list |
| org.Ag.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list; ~40MB each |
| org.At.tair.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.Bt.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.Ce.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.Cf.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.Dm.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.Dr.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.EcK12.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.EcSakai.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.Gg.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.Hs.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.Mm.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.Mmu.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.Pt.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.Rn.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.Sc.sgd.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.Ss.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| org.Xl.eg.db | ✗ | ✗ | ✓ | Not in hardcoded bioc list |
| ottoPlots | ✗ | ✓ | ✓ | Dedicated GitHub install step |
| pathview | ✓ | ✓ | ✓ | |
| PCAtools | ✓ | ✓ | ✓ | |
| PGSEA | ✗ | ✗ | ✓ | Archived from Bioc 3.10, no special handling |
| pkgload | ✓ | ✓ | ✓ | |
| plotly | ✓ | ✓ | ✓ | |
| png | ✓ | ✓ | ✓ | |
| preprocessCore | ✗ | L/M only | ✓ | Not in Windows hardcoded bioc list |
| purrr | ✓ | ✓ | ✓ | |
| QUBIC | ✓ | ✓ | ✓ | |
| R.utils | ✓ | ✓ | ✓ | |
| RColorBrewer | ✗ | ✓ | ✓ | |
| ReactomePA | ✗ | ✗ | ✓ | Not in hardcoded bioc list; may NOT be transitive |
| readxl | ✓ | ✓ | ✓ | |
| reshape2 | ✓ | ✓ | ✓ | |
| rmarkdown | ✓ | ✓ | ✓ | |
| RSQLite | ✓ | ✓ | ✓ | |
| Rtsne | ✓ | ✓ | ✓ | |
| runibic | ✗ | ✗ | ✓ | Not in hardcoded bioc list; may NOT be transitive |
| S4Vectors | ✗ | ~ | ✓ | Not in hardcoded bioc list; likely transitive dep |
| shiny | ✓ | ✓ | ✓ | |
| shinyAce | ✗ | ✓ | ✓ | |
| shinyBS | ✓ | ✓ | ✓ | |
| shinybusy | ✓ | ✓ | ✓ | |
| shinyjs | ✓ | ✓ | ✓ | |
| stringr | ✓ | ✓ | ✓ | |
| SummarizedExperiment | ✗ | L/M only | ✓ | Not in Windows hardcoded bioc list |
| tidyr | ✓ | ✓ | ✓ | |
| tidyselect | ✓ | ✓ | ✓ | |
| tidytext | ✓ | ✓ | ✓ | |
| tippy | ✓ | ✓ | ✓ | |
| utils | ✓ | ✓ | ✓ | Base R |
| visNetwork | ✓ | ✓ | ✓ | |
| WGCNA | ✓ | ✓ | ✓ | On CRAN despite being in bioc list |
| wordcloud2 | ✓ | ✓ | ✓ | |

**Legend:** ✓ = yes, ✗ = no, ~ = probably (transitive dep), L/M = Linux/Mac only
