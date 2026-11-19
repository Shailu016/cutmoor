
declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      "stick-scene": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { scene?: string; play?: string; zoom?: string; "no-font"?: string; ref?: React.Ref<HTMLElement> };
    }
  }
}
