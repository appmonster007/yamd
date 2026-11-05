# Build

**YAMD: Build** refreshes everything the extension generates and nothing else: reference links (`[@fig-arch]` becomes `[Figure 2](#fig-arch)`), citation links, the table of contents and the bibliography. Run it twice and the second run changes nothing.

Generated parts live between comments you can see:

````
<!-- yamd:toc depth=3 -->
<!-- /yamd:toc -->
````

Set `yamd.build.onSave` to build whenever you save.
