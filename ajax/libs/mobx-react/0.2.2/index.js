(function() {
    function mrFactory(mobservable, ReactDep, ReactNativeDep) {
        if (!mobservable)
            throw new Error("mobservable-react requires the Mobservable package.")
        var React = ReactNativeDep || ReactDep;
        if (!React)
            throw new Error("mobservable-react requires either React or ReactNative to be available");

        var isTracking = false;

        // WeakMap<Node, Object>;
        var componentByNodeRegistery = typeof WeakMap !== "undefined" ? new WeakMap() : undefined;
        var renderReporter = new mobservable._.SimpleEventEmitter();

        function reportRendering(component) {
            // TODO: Fix in 0.14: React.findDOMNode is deprecated. Please use ReactDOM.findDOMNode from require('react-dom') instead.
            var node = React.findDOMNode(component);
            if (node)
                componentByNodeRegistery.set(node, component);

            renderReporter.emit({
                event: 'render',
                renderTime: component.__$mobRenderEnd - component.__$mobRenderStart,
                totalTime: Date.now() - component.__$mobRenderStart,
                component: component,
                node: node
            });
        }

        var reactiveMixin = {
            componentWillMount: function() {
                var baseRender = this.render;
                this.__$mobDependencies = [];

                this.render = function() {
                    if (isTracking)
                        this.__$mobRenderStart = Date.now();

                    // invoke the old render function and in the mean time track all dependencies using
                    // 'observe'.
                    // when the dependencies change, the function is triggered, but we don't want to 
                    // rerender because that would ignore the normal React lifecycle, 
                    // so instead we dispose the current observer and trigger a force update.
                    var hasRendered = false;
                    var rendering;
                    this.__$mobDisposer = mobservable.observe(function reactiveRender() {
                        if (!hasRendered) {
                            hasRendered = true;
                            rendering = baseRender.call(this);
                        } else {
                            this.__$mobDisposer();
                            React.Component.prototype.forceUpdate.call(this);
                        }
                    }, this);

                    // make sure views are not disposed between the clean-up of the observer and the next render
                    // (invoked through force update)
                    this.$mobservable = this.__$mobDisposer.$mobservable;
                    var newDependencies = this.$mobservable.observing.map(function(dep) {
                        dep.setRefCount(+1);
                        return dep;
                    });
                    this.__$mobDependencies.forEach(function(dep) {
                        dep.setRefCount(-1);
                    });
                    this.__$mobDependencies = newDependencies;
                    
                    if (isTracking)
                        this.__$mobRenderEnd = Date.now();
                    return rendering;
                }
            },

            componentWillUnmount: function() {
                this.__$mobDisposer && this.__$mobDisposer();
                this.__$mobDependencies.forEach(function(dep) {
                    dep.setRefCount(-1);
                });
                delete this.$mobservable;
                if (isTracking) {
                    // TODO: Fix in 0.14: React.findDOMNode is deprecated. Please use ReactDOM.findDOMNode from require('react-dom') instead.
                    var node = React.findDOMNode(this);
                    if (node) {
                        componentByNodeRegistery.delete(node);
                        renderReporter.emit({
                            event: 'destroy',
                            component: this,
                            node: node
                        });
                    }
                }
            },

            componentDidMount: function() {
                if (isTracking)
                    reportRendering(this);
            },

            componentDidUpdate: function() {
                if (isTracking)
                    reportRendering(this);
            },

            shouldComponentUpdate: function(nextProps, nextState) {
                // update on any state changes (as is the default)
                if (this.state !== nextState)
                    return true;
                // update if props are shallowly not equal, inspired by PureRenderMixin
                var keys = Object.keys(this.props);
                var key;
                if (keys.length !== Object.keys(nextProps).length)
                    return true;
                for(var i = keys.length -1; i >= 0, key = keys[i]; i--) {
                    var newValue = nextProps[key];
                    if (newValue !== this.props[key]) {
                        return true;
                    } else if (newValue && typeof newValue === "object" && !mobservable.isReactive(newValue)) {
                        /**
                         * If the newValue is still the same object, but that object is not reactive,
                         * fallback to the default React behavior: update, because the object *might* have changed.
                         * If you need the non default behavior, just use the React pure render mixin, as that one 
                         * will work fine with mobservable as well, instead of the default implementation of 
                         * reactiveComponent.
                         */
                        return true;
                    }
                }
                return false;
            }
        }

        function patch(target, funcName) {
            var base = target[funcName];
            var mixinFunc = reactiveMixin[funcName];
            target[funcName] = function() {
                base && base.apply(this, arguments);
                mixinFunc.apply(this, arguments);
            }
        }

        function reactiveComponent(componentClass) {
            // If it is function but doesn't seem to be a react class constructor,
            // wrap it to a react class automatically
            if (typeof componentClass === "function" && !componentClass.prototype.render && !componentClass.isReactClass && !React.Component.isPrototypeOf(componentClass)) {
                return reactiveComponent(React.createClass({
                    displayName: componentClass.name,
                    render: function() {
                        return componentClass.call(this, this.props);
                    }
                }));
            }
            
            if (!componentClass)
                throw new Error("Please pass a valid component to 'reactiveComponent'");
            var target = componentClass.prototype || componentClass;

            [
                "componentWillMount",
                "componentWillUnmount",
                "componentDidMount",
                "componentDidUpdate"
            ].forEach(function(funcName) {
                patch(target, funcName)
            });

            if (!target.shouldComponentUpdate)
                target.shouldComponentUpdate = reactiveMixin.shouldComponentUpdate;
            return componentClass;
        }

        function trackComponents() {
            if (typeof WeakMap === "undefined")
                throw new Error("tracking components is not supported in this browser");
            if (!isTracking)
                isTracking = true;
        }

        return ({
            reactiveComponent: reactiveComponent,
            renderReporter: renderReporter,
            componentByNodeRegistery: componentByNodeRegistery,
            trackComponents: trackComponents
        });
    }

    // UMD
    if (typeof define === 'function' && define.amd) {
        define('mobservable-react', ['mobservable', 'react', 'react-native'], mrFactory);
    } else if (typeof exports === 'object') {
        module.exports = mrFactory(
            require('mobservable'),
            function () {
                try { 
                    return require('react');
                }
                catch (e) { 
                    return null; 
                } 
            }(),
            function() {
                try { 
                    return require('react-native'); 
                }
                catch (e) { 
                    return null; 
                } 
            }()
        );
    } else {
        this.mobservableReact = mrFactory(this['mobservable'], this['React'], this['ReactNative']);
    }
})();
