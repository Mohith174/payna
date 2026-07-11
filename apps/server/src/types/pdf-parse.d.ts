// @types/pdf-parse only covers the package root; we import the implementation
// module directly (the root entry runs demo code under ESM). Re-point the types.
declare module "pdf-parse/lib/pdf-parse.js" {
  import pdfParse from "pdf-parse";
  export default pdfParse;
}
