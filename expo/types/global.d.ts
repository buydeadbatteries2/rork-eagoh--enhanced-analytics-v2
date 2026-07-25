/// <reference types="react" />

import 'react';

declare global {
  namespace JSX {
    interface Element extends React.ReactElement<any, any> {}
    type ElementType = React.ElementType;
    interface ElementClass extends React.ComponentClass<any> {}
    interface ElementAttributesProperty { props: any; }
    interface ElementChildrenAttribute { children: any; }
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
    interface IntrinsicAttributes extends React.JSX.IntrinsicAttributes {}
    interface IntrinsicClassAttributes<T> extends React.JSX.IntrinsicClassAttributes<T> {}
  }
}
