 
import React from "react";
const props = { id: "x" };
const BooleanValue = () => <input disabled readOnly />;
const CurlyBracePresence = () => <div className="foo" id="bar">text content</div>;
const FragmentLong = () => (<>
      <div />
      <span />
                            </>);
const SpreadMulti = () => <div {...props} />;
const SelfClosing = () => <div />;
const SelfClosingSpan = () => <span />;
const AriaInvalidProp = () => <div aria-fakething="yes" aria-invalidprop="true" />;
const AriaUnsupportedElements = () => <meta  />;
const NoAriaHiddenOnFocusable = () => <button >click me</button>;
const RedundantRoles = () => (<div>
      <nav  />
      <ul role="list" />
      <button  />
                              </div>);
const ScopeOnNonTh = () => <div  />;
const TailwindClassOrder = () => <div className="flex-col p-4 mt-2 flex items-center mb-4 text-red-500 bg-blue-100 justify-center w-full h-full" />;
const TailwindDuplicateClasses = () => <div className="flex flex items-center items-center p-4" />;
const TailwindUnnecessaryWhitespace = () => <div className="  flex   items-center   p-4  " />;
const TailwindShorthand = () => <div className="pt-4 pr-4 pb-4 pl-4" />;
export {
  AriaInvalidProp,
  AriaUnsupportedElements,
  BooleanValue,
  ClasslistToggle,
  CurlyBracePresence,
  DomAppend,
  DomDataset,
  DomTextContent,
  FragmentLong,
  KeyboardEvent,
  NoAriaHiddenOnFocusable,
  QuerySelector,
  RedundantRoles,
  ScopeOnNonTh,
  SelfClosing,
  SelfClosingSpan,
  SpreadMulti,
  TailwindClassOrder,
  TailwindDuplicateClasses,
  TailwindShorthand,
  TailwindUnnecessaryWhitespace,
};
const DomAppend = () => {
  const el = document.createElement("div")
  const child = document.createElement("span")
  el.append(child)
  return <div />
};
const DomDataset = () => {
  const el = document.createElement("div")
  el.dataset.value = "1"
  return <div />
};
const DomTextContent = () => {
  const el = document.createElement("div")
  const text = el.textContent
  return <div>{text}</div>
};
const KeyboardEvent = () => {
  document.addEventListener("keydown", (e) => {
    if (e.key === 'Enter') return
  })
  return <div />
};
const QuerySelector = () => {
  const el = document.querySelector("#app")
  return <div>{el?.id}</div>
};
const ClasslistToggle = () => {
  const el = document.createElement("div")
  el.classList.toggle("active", !(el.classList.contains("active")));
  return <div />
};
